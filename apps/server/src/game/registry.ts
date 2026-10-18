import {
  type GamePlayer,
  isQueueMode,
  type ModeId,
  type PowerupId,
  START_RATING,
  type TeamId,
  unlockedIds,
} from '@quiz/shared';
import { unlockContext } from '../account';
import { friendsChanged } from '../notify';
import { markSeen, pickQuestions, type PreparedQuestion, recentFor } from '../questions';
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
      rating: isQueueMode(mode) ? Math.round(getRating(userId, mode)) : null,
      avatar: row.avatar,
      frame: row.frame,
      title: row.title,
      team: null,
    },
    // The daily challenge is a level playing field: no jokers.
    powerups: mode === 'daily' ? [] : (unlockedIds('powerup', ctx) as PowerupId[]),
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
  sorted.forEach((e, i) => (e.player.team = pattern[i % 4]));
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
  /** Fixed question set (daily challenge); otherwise picked fresh. */
  questions?: PreparedQuestion[];
  humans: HumanEntry[];
  bots: Bot[];
}

export class GameRegistry {
  private games = new Map<string, Game>();
  private byUser = new Map<number, Game>();
  private closedListeners: ((game: Game) => void)[] = [];

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

  start(opts: NewGame): Game {
    const userIds = opts.humans.map((h) => h.player.userId!);
    const questions = opts.questions ?? pickQuestions(opts.questionCount, opts.category, recentFor(userIds));
    if (questions.length < opts.questionCount) throw new Error('Няма достатъчно въпроси за тази категория.');

    const room = (id: string) => `game:${id}`;
    let game: Game;
    const emitter: GameEmitter = {
      toGame: (event, ...args) => (this.io.to(room(game.id)).emit as any)(event, ...args),
      toUser: (userId, event, ...args) => (this.io.to(`user:${userId}`).emit as any)(event, ...args),
      toGameExcept: (userId, event, ...args) =>
        (this.io.to(room(game.id)).except(`user:${userId}`).emit as any)(event, ...args),
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
        questions,
        humans: opts.humans,
        bots: opts.bots,
      },
      emitter,
      { finalize: finalizeMatch, onClosed: (g) => this.close(g) },
    );

    this.games.set(game.id, game);
    for (const userId of userIds) {
      this.byUser.set(userId, game);
      this.io.in(`user:${userId}`).socketsJoin(room(game.id));
      markSeen(userId, questions.map((q) => q.id));
    }
    friendsChanged(...userIds);
    game.start();
    return game;
  }

  /** Forfeit: the player is out of the match and free to do other things. */
  leave(userId: number) {
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
  }
}
