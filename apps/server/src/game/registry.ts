import {
  type GameEndPayload,
  type GamePlayer,
  type GameStartPayload,
  isQueueMode,
  MODES,
  type ModeId,
  POWERUPS,
  type PowerupId,
  ROUNDS_QUESTIONS,
  START_RATING,
  type TeamId,
  unlockedIds,
} from '@quiz/shared';
import { unlockContext } from '../account';
import { crowdFor } from '../answers';
import { releaseChallengeAttempt, saveChallengeProgress } from '../challenges';
import { releaseDailyAttempt, saveDailyProgress } from '../daily';
import { bestMastery } from '../mastery';
import { reportError } from '../monitoring';
import { friendsChanged } from '../notify';
import {
  markSeen,
  type PreparedQuestion,
  pickMatch,
  pickRounds,
  type RoundPlan,
  recentFor,
  seenBy,
} from '../questions';
import { getRating } from '../seasons';
import { skillCentre } from '../skill';
import { getUser } from '../users';
import type { Bot } from './bots';
import { Game, type GameEmitter, type GameSetup, type RecordScript, STILL_MS } from './Game';
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
      mastery: bestMastery(userId),
    },
    // Runs everyone compares (the daily, challenge links) and „Поправителен“ (recall, unaided): no козове. Everywhere
    // else all of them for everyone, from the first match: a result isn't decided by who has played longer.
    powerups: mode === 'daily' || mode === 'challenge' || mode === 'review' ? [] : POWERUPS.map((p) => p.id),
    emotes: unlockedIds('emote', ctx),
  };
}

/** The humans' average level, and the skill their bots are centred on (skillCentre: `ratingFor` until it's known). */
export function averageOf(humans: HumanEntry[], ratingFor = (h: HumanEntry) => h.player.rating) {
  const n = Math.max(1, humans.length);
  return {
    level: humans.reduce((s, h) => s + h.player.level, 0) / n,
    skill: humans.reduce((s, h) => s + skillCentre(h.player.userId!, ratingFor(h)), 0) / n,
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
  /** Fixed question set (daily challenge, challenge link); otherwise picked fresh (in ROUNDS where the mode is). */
  questions?: PreparedQuestion[];
  /** The rounds of a fixed set played in rounds (a recording's Дуел). */
  rounds?: RoundPlan[];
  /** Recordings of real players' matches to play against (records.ts), with whose they are. */
  records?: { player: GamePlayer; script: RecordScript; runId: number; ownerId: number }[];
  /** A friend duel: who it's against. */
  duelWith?: GameSetup['duelWith'];
  /** Overrides the mode's own ROUNDS, number final and formats (a room's settings). */
  inRounds?: boolean;
  final?: boolean;
  /** A room of pictures: every question about one, as far as the bank has them. */
  pictures?: boolean;
  /** A room's host who runs it on a big screen instead of playing. */
  presenter?: number | null;
  /** A room playing its host's own set (its name; `questions` are the set's). */
  questionSet?: string | null;
  /** The evening Роял of this day. */
  eveningDay?: string | null;
  /** Соло's clock. */
  pace?: GameSetup['pace'];
  /** A number final's weight, for a set made before it counted double. */
  finalTimes?: number;
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

/** Why a match can't start, in words for the player (any other error is ours: they're told only that it failed). */
export class StartError extends Error {}

/** What a player is told when their match couldn't start; an error that isn't a StartError is reported, not shown. */
export function startFailure(err: unknown): string {
  if (err instanceof StartError) return err.message;
  void reportError(err, 'start a match');
  return 'Играта не можа да започне.';
}

/** A daily or challenge-link run reveals an answer: its score so far stands if the run is cut short from here on. */
function saveProgress(game: Game) {
  for (const h of game.humans) {
    const userId = h.player.userId!;
    if (game.setup.dailyDay)
      saveDailyProgress(userId, game.setup.dailyDay, game.played, h.score, h.correct, h.answerMs);
    if (game.setup.challengeId)
      saveChallengeProgress(game.setup.challengeId, userId, game.played, h.score, h.correct, h.answerMs);
  }
}

/** How long a result waits for a player who was offline when their match ended. */
const MISSED_RESULT_MS = 15 * 60_000;

export class GameRegistry {
  private games = new Map<string, Game>();
  private byUser = new Map<number, Game>();
  /** Room hosts running a match on a big screen, by user id. */
  private presenting = new Map<number, Game>();
  private missed = new Map<number, { start: GameStartPayload; end: GameEndPayload; until: number }>();
  private closedListeners: ((game: Game) => void)[] = [];
  private idleWaiters: (() => void)[] = [];
  private draining = false;

  constructor(private io: IO) {
    setInterval(() => this.sweepStuck(), 5 * 60_000).unref();
  }

  /**
   * A match can run long (an untimed Соло, a player who keeps coming back), but it never stands still longer than
   * STILL_MS. One that does is stuck on a bug: its players would be "in a game" until a restart.
   */
  private sweepStuck(now = Date.now()) {
    for (const game of [...this.games.values()]) {
      if (now - game.movedAt < STILL_MS) continue;
      void reportError(new Error('A match stood still too long'), 'stuck match', {
        extra: {
          match: game.id,
          mode: game.setup.mode,
          phase: game.phase,
          minutes: Math.round((now - game.startedAt) / 60_000),
        },
      });
      game.stop();
      if (this.games.has(game.id)) this.close(game);
    }
  }

  onClosed(listener: (game: Game) => void) {
    this.closedListeners.push(listener);
  }

  /** The match a user is currently playing (not one they walked out of). */
  forUser(userId: number): Game | undefined {
    return this.byUser.get(userId);
  }

  /** The match a room's host is running on a big screen without playing in it. */
  presentedBy(userId: number): Game | undefined {
    return this.presenting.get(userId);
  }

  get playersInGame() {
    return this.byUser.size;
  }

  get activeGames() {
    return this.games.size;
  }

  /** Matches under way, by mode (the live report). */
  byMode(): Partial<Record<ModeId, number>> {
    const n: Partial<Record<ModeId, number>> = {};
    for (const g of this.games.values()) n[g.setup.mode] = (n[g.setup.mode] ?? 0) + 1;
    return n;
  }

  /**
   * The server is about to stop: runs waiting for an absent player end now (their attempt kept) instead of holding the
   * restart up until the drain times out, and runs stopped on a fact go on; from here on a run whose player drops ends
   * the same way, and nobody can stop on a fact.
   */
  startDraining() {
    this.draining = true;
    for (const game of [...this.games.values()]) game.drain();
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
    const def = MODES[opts.mode];
    const seen = opts.questions ? new Map<string, number>() : recentFor(userIds);
    // Three or more people: the final and the formats are the ones the fewest of them saw lately, rather than none
    // (a regular group's evening lost both); a final someone saw counts once (questions.ts → Crowd).
    const crowd = !opts.questions && userIds.length >= 3 ? seenBy(userIds) : undefined;
    const final = opts.final ?? def.final;
    const inRounds =
      !opts.questions &&
      (opts.inRounds ?? def.rounds) &&
      opts.category === 'mixed' &&
      opts.questionCount === ROUNDS_QUESTIONS
        ? pickRounds(seen, Math.random, { final, formats: def.formats, crowd })
        : null;
    const questions =
      opts.questions ??
      inRounds?.questions ??
      pickMatch(opts.questionCount, opts.category, seen, {
        final,
        formats: def.formats,
        pictures: opts.pictures,
        crowd,
      });
    const last = questions.at(-1);
    const finalSeen = !!crowd && last?.kind === 'number' && (crowd.get(last.id) ?? 0) > 0;
    if (questions.length < opts.questionCount) throw new StartError('Няма достатъчно въпроси за тази категория.');

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
        rounds: opts.rounds ?? inRounds?.rounds ?? [],
        humans: opts.humans,
        bots: opts.bots,
        records: opts.records ?? [],
        duelWith: opts.duelWith ?? null,
        presenter: opts.presenter ?? null,
        questionSet: opts.questionSet ?? null,
        eveningDay: opts.eveningDay ?? null,
        pace: opts.pace ?? 'normal',
        finalTimes: opts.finalTimes ?? (finalSeen ? 1 : undefined),
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
        progress: saveProgress,
        draining: () => this.draining,
        crowd: crowdFor,
        shown: (g, questionIds) => {
          for (const h of g.humans) markSeen(h.player.userId!, questionIds);
        },
        undelivered: (userId, start, end) => this.keepMissed(userId, start, end),
        onClosed: (g) => this.close(g),
      },
    );

    // Bookkeeping first: once the match is registered nothing may fail before it starts, or its players would be
    // stuck "in a game" that never runs. A round still to be picked isn't seen yet (shown() comes when it is); a host's
    // own set isn't the bank's.
    for (const userId of opts.questionSet ? [] : userIds) {
      try {
        markSeen(
          userId,
          game.settledQuestions().map((q) => q.id),
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
    // The host running it on a big screen hears everything the match's room does, and gets in again after a drop.
    if (opts.presenter) {
      this.presenting.set(opts.presenter, game);
      this.io.in(`user:${opts.presenter}`).socketsJoin(room(game.id));
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
    // Once only: a match closed twice (its end ran again after a bug) mustn't tell its listeners twice.
    if (!this.games.delete(game.id)) return;
    const presenter = game.setup.presenter;
    if (presenter && this.presenting.get(presenter) === game) this.presenting.delete(presenter);
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
