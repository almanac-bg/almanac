import {
  type GameEndPayload,
  type GamePlayer,
  type GameStartPayload,
  isQueueMode,
  type ModeId,
  POWERUPS,
  type PowerupId,
  START_RATING,
  type TeamId,
  unlockedIds,
} from '@quiz/shared';
import { unlockContext } from '../account';
import { releaseChallengeAttempt } from '../challenges';
import { releaseDailyAttempt } from '../daily';
import { friendsChanged } from '../notify';
import { markSeen, type PreparedQuestion, pickQuestions, recentFor } from '../questions';
import { getRating } from '../seasons';
import { getUser } from '../users';
import type { Bot } from './bots';
import { Game, type GameEmitter, type GameSetup } from './Game';
import type { IO } from './io';
import { finalizeMatch } from './rewards';

export interface HumanEntry {
  player: GamePlayer;
  powerups: PowerupId[];
  emotes: string[];
}

/** Loads a user's in-game identity: loadout, level, rating and unlocked toys. */
export function buildHuman(userId: number, mode: ModeId): HumanEntry {
  const row = getUser(userId)!;
  const ctx = unlockContext(userId);
  return {
    player: {
      id: `u${userId}`,
      userId,
      name: row.username,
      level: ctx.level,
      isBot: false,
      isGuest: !!row.is_guest,
      rating: isQueueMode(mode) ? Math.round(getRating(userId, mode)) : null,
      avatar: row.avatar,
      frame: row.frame,
      title: row.title,
      team: null,
    },
    // Runs everyone compares (the daily, challenge links): no козове. Everywhere else all of them for everyone, from
    // the first match: a result isn't decided by who has played longer.
    powerups: mode === 'daily' || mode === 'challenge' ? [] : POWERUPS.map((p) => p.id),
    emotes: unlockedIds('emote', ctx),
  };
}

export function averageOf(humans: HumanEntry[]) {
  const n = Math.max(1, humans.length);
  return {
    level: humans.reduce((s, h) => s + h.player.level, 0) / n,
    rating: humans.reduce((s, h) => s + (h.player.rating ?? START_RATING), 0) / n,
  };
}

/** Splits players into two rating-balanced teams: strongest + weakest vs the middle two (snake draft). */
export function balanceTeams<T extends { player: GamePlayer }>(entries: T[]): T[] {
  const sorted = [...entries].sort((a, b) => (b.player.rating ?? START_RATING) - (a.player.rating ?? START_RATING));
  const pattern: TeamId[] = [0, 1, 1, 0];
  for (const [i, e] of sorted.entries()) e.player.team = pattern[i % 4];
  return entries;
}

export interface NewGame {
  mode: ModeId;
  ranked: boolean;
  roomCode: string | null;
  hostUserId: number | null;
  questionCount: number;
  timeMs: number;
  category: GameSetup['category'];
  elimination: boolean;
  teams?: boolean;
  dailyDay?: string | null;
  challengeId?: string | null;
  /** Fixed question set (daily challenge, challenge link); otherwise picked fresh. */
  questions?: PreparedQuestion[];
  humans: HumanEntry[];
  bots: Bot[];
}

/** A daily or challenge-link run that ended without a result: its one attempt is the player's again. */
function releaseAttempts(game: Game) {
  for (const h of game.humans) {
    if (game.setup.dailyDay) releaseDailyAttempt(h.player.userId!, game.setup.dailyDay);
    if (game.setup.challengeId) releaseChallengeAttempt(game.setup.challengeId, h.player.userId!);
  }
}

/** How long a result waits for a player who was offline when their match ended. */
const MISSED_RESULT_MS = 15 * 60_000;

export class GameRegistry {
  private games = new Map<string, Game>();
  private byUser = new Map<number, Game>();
  private missed = new Map<number, { start: GameStartPayload; end: GameEndPayload; until: number }>();
  private closedListeners: ((game: Game) => void)[] = [];
  private idleWaiters: (() => void)[] = [];
  private draining = false;

  constructor(private io: IO) {}

  onClosed(listener: (game: Game) => void) {
    this.closedListeners.push(listener);
  }

  /** The match a user is currently playing (not one they walked out of). */
  forUser(userId: number): Game | undefined {
    return this.byUser.get(userId);
  }

  get playersInGame() {
    return this.byUser.size;
  }

  get activeGames() {
    return this.games.size;
  }

  /**
   * The server is about to stop: runs waiting for an absent player end now (their attempt kept) instead of holding the
   * restart up until the drain times out; from here on a run whose player drops ends the same way.
   */
  startDraining() {
    this.draining = true;
    for (const game of [...this.games.values()]) if (game.held) game.endForDrain();
  }

  /** Ends every match still running (the server is stopping); returns how many there were. */
  stopAll(): number {
    const live = [...this.games.values()];
    for (const game of live) game.stop();
    return live.length;
  }

  /** Resolves once no match is running (or after `maxMs`). */
  idle(maxMs: number): Promise<void> {
    if (this.games.size === 0 || maxMs <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, maxMs);
      this.idleWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  start(opts: NewGame): Game {
    const userIds = opts.humans.map((h) => h.player.userId!);
    const questions = opts.questions ?? pickQuestions(opts.questionCount, opts.category, recentFor(userIds));
    if (questions.length < opts.questionCount) throw new Error('Няма достатъчно въпроси за тази категория.');

    const room = (id: string) => `game:${id}`;
    let game: Game;
    const emitter: GameEmitter = {
      toGame: (event, ...args) => this.io.to(room(game.id)).emit(event, ...args),
      toUser: (userId, event, ...args) => this.io.to(`user:${userId}`).emit(event, ...args),
      toGameExcept: (userId, event, ...args) =>
        this.io
          .to(room(game.id))
          .except(`user:${userId}`)
          .emit(event, ...args),
    };
    game = new Game(
      {
        mode: opts.mode,
        ranked: opts.ranked,
        roomCode: opts.roomCode,
        hostUserId: opts.hostUserId,
        timeMs: opts.timeMs,
        category: opts.category,
        elimination: opts.elimination,
        teams: opts.teams ?? false,
        dailyDay: opts.dailyDay ?? null,
        challengeId: opts.challengeId ?? null,
        questions,
        humans: opts.humans,
        bots: opts.bots,
      },
      emitter,
      {
        finalize: (g, standings) => {
          try {
            return finalizeMatch(g, standings);
          } catch (err) {
            // Nothing of the match was saved: a daily or challenge-link run must not cost the player their one try.
            releaseAttempts(g);
            throw err;
          }
        },
        release: releaseAttempts,
        draining: () => this.draining,
        undelivered: (userId, start, end) => this.keepMissed(userId, start, end),
        onClosed: (g) => this.close(g),
      },
    );

    // Bookkeeping first: once the match is registered nothing may fail before it starts, or its players would be
    // stuck "in a game" that never runs.
    for (const userId of userIds) {
      try {
        markSeen(
          userId,
          questions.map((q) => q.id),
        );
      } catch (err) {
        console.error(`Could not record the questions user ${userId} saw`, err);
      }
    }
    this.games.set(game.id, game);
    for (const userId of userIds) {
      this.missed.delete(userId);
      this.byUser.set(userId, game);
      this.io.in(`user:${userId}`).socketsJoin(room(game.id));
    }
    try {
      game.start();
    } catch (err) {
      this.close(game);
      throw err;
    }
    friendsChanged(...userIds);
    return game;
  }

  /** The result of a match that ended while this player was offline (once). */
  takeMissed(userId: number) {
    const missed = this.missed.get(userId);
    this.missed.delete(userId);
    return missed && missed.until > Date.now() ? missed : null;
  }

  private keepMissed(userId: number, start: GameStartPayload, end: GameEndPayload) {
    const now = Date.now();
    for (const [id, m] of this.missed) if (m.until < now) this.missed.delete(id);
    this.missed.set(userId, { start, end, until: now + MISSED_RESULT_MS });
  }

  /** Forfeit: the player is out of the match and free to do other things. */
  leave(userId: number) {
    this.missed.delete(userId);
    const game = this.byUser.get(userId);
    if (!game) return;
    this.byUser.delete(userId);
    this.io.in(`user:${userId}`).socketsLeave(`game:${game.id}`);
    game.leave(game.playerIdFor(userId));
    friendsChanged(userId);
  }

  private close(game: Game) {
    this.games.delete(game.id);
    const userIds: number[] = [];
    for (const p of game.humans) {
      const userId = p.player.userId!;
      if (this.byUser.get(userId) === game) {
        this.byUser.delete(userId);
        userIds.push(userId);
      }
    }
    this.io.in(`game:${game.id}`).socketsLeave(`game:${game.id}`);
    friendsChanged(...userIds);
    for (const listener of this.closedListeners) listener(game);
    if (this.games.size === 0) for (const done of this.idleWaiters.splice(0)) done();
  }
}
