import { type AckResult, dayKey, EVENING, type EveningStatus, MODES, shiftDay } from '@quiz/shared';
import { eveningStartsAt } from '../evening';
import { guarded } from '../guard';
import { reportError } from '../monitoring';
import { friendsChanged } from '../notify';
import { count } from '../stats';
import { makeBots } from './bots';
import type { Game } from './Game';
import type { IO } from './io';
import { averageOf, buildHuman, type GameRegistry } from './registry';

/** After a restart, the lobby the last process kept waits this long for its players to come back before it starts. */
const REJOIN_MS = 30_000;

/** The lobby as one server process hands it to the next on a restart (kept(), restore()). */
export interface KeptEvening {
  day: string;
  waiting: number[];
}

/**
 * The evening Роял's lobby (EVENING): open EVENING.lobbyMinutes before the start; at the start everyone in it plays —
 * up to EVENING.maxPlayers a match (more make more matches of even size), bots making up only MODES.evening.minPlayers.
 * `now` is a clock tests can turn.
 */
export class EveningLobby {
  private waiting = new Set<number>();
  /** The day whose evening has started (its lobby closed). */
  private startedFor: string | null = null;
  private live = new Set<Game>();
  /** When the lobby the last process kept was taken over (see REJOIN_MS). */
  private restoredAt = Number.NEGATIVE_INFINITY;

  constructor(
    private io: IO,
    private games: GameRegistry,
    private isOnline: (userId: number) => boolean,
    /** The server is about to restart: the evening doesn't start in this process, the next one starts it. */
    private draining: () => boolean = () => false,
    private now: () => number = Date.now,
  ) {
    setInterval(
      guarded('evening', () => this.tick()),
      1000,
    ).unref();
    games.onClosed((game) => {
      if (this.live.delete(game) && this.live.size === 0) this.broadcast();
    });
  }

  /**
   * The evening that's next or on now: today's until its matches are over (or it's past with nobody in it), else
   * tomorrow's. Null without an evening Роял.
   */
  private schedule(): { day: string; startsAt: number; opensAt: number } | null {
    const now = this.now();
    for (const day of [dayKey(now), shiftDay(dayKey(now), 1)]) {
      const startsAt = eveningStartsAt(day);
      if (startsAt === null) return null;
      // Past its start with the lobby still waiting: a restart came at the start, and it starts in a moment.
      const over = now >= startsAt && (this.startedFor === day ? this.live.size === 0 : this.waiting.size === 0);
      if (!over) return { day, startsAt, opensAt: startsAt - EVENING.lobbyMinutes * 60_000 };
    }
    return null;
  }

  status(userId: number | null = null): EveningStatus | null {
    const s = this.schedule();
    if (!s) return null;
    return {
      ...s,
      waiting: this.waiting.size,
      joined: userId !== null && this.waiting.has(userId),
      live: this.startedFor === s.day && this.live.size > 0,
    };
  }

  has(userId: number) {
    return this.waiting.has(userId);
  }

  join(userId: number): AckResult {
    const s = this.schedule();
    const now = this.now();
    if (!s) return { ok: false, error: 'Вечерният Роял не се играе тук.' };
    if (now < s.opensAt) return { ok: false, error: 'Входът се отваря 5 минути преди началото.' };
    if (this.startedFor === s.day) return { ok: false, error: 'Тази вечер вече започна — до утре!' };
    this.waiting.add(userId);
    friendsChanged(userId);
    this.broadcast();
    return { ok: true };
  }

  leave(userId: number) {
    if (!this.waiting.delete(userId)) return;
    friendsChanged(userId);
    this.io.to(`user:${userId}`).emit('evening:status', this.status(userId)!);
    this.broadcast();
  }

  /** The server starts draining for a restart: whoever is in the lobby hears that their place is kept. */
  drain() {
    for (const userId of this.waiting)
      this.io.to(`user:${userId}`).emit('notice', {
        kind: 'info',
        message: 'Обновяваме играта за минута. Мястото ти във Вечерния Роял се пази.',
      });
  }

  /** The lobby, for the next process to carry on (a restart just before the evening keeps everyone's place). */
  kept(): KeptEvening | null {
    const s = this.schedule();
    if (!s || this.startedFor === s.day || !this.waiting.size) return null;
    return { day: s.day, waiting: [...this.waiting] };
  }

  /** The lobby the last process kept, if it's still this evening's (starting late if the start came meanwhile). */
  restore(kept: KeptEvening | null) {
    if (!kept) return;
    this.restoredAt = this.now();
    for (const id of kept.waiting) this.waiting.add(id);
    if (this.schedule()?.day !== kept.day) this.waiting.clear();
  }

  private tick() {
    const now = this.now();
    const day = dayKey(now);
    const startsAt = eveningStartsAt(day);
    if (startsAt === null || this.startedFor === day || now < startsAt) return;
    // Not while the server drains: the lobby goes to the next process, which starts the evening a minute late.
    if (this.draining()) return;
    // Just taken over: a moment for everyone in it to come back (their page reconnects), unless they all have.
    if (now - this.restoredAt < REJOIN_MS && [...this.waiting].some((id) => !this.isOnline(id))) return;
    this.startedFor = day;
    // Whoever is still here and free (a dropped connection or another match in the meantime is no seat).
    const players = [...this.waiting].filter((id) => this.isOnline(id) && !this.games.forUser(id));
    this.waiting.clear();
    friendsChanged(...players);
    if (players.length) this.launch(day, players);
    this.broadcast();
  }

  /** Everyone in matches of up to EVENING.maxPlayers, as even as they come (51 make two of 26 and 25). */
  private launch(day: string, userIds: number[]) {
    const matches = Math.ceil(userIds.length / EVENING.maxPlayers);
    const def = MODES.evening;
    for (let m = 0; m < matches; m++) {
      const ids = userIds.filter((_, i) => i % matches === m);
      try {
        const humans = ids.map((id) => buildHuman(id, 'evening'));
        const bots = makeBots(
          Math.max(0, (def.minPlayers ?? 0) - humans.length),
          averageOf(humans),
          humans.map((h) => h.player.name),
        );
        const game = this.games.start({
          mode: 'evening',
          ranked: false,
          roomCode: null,
          hostUserId: null,
          questionCount: def.questions,
          timeMs: def.timeMs,
          category: 'mixed',
          elimination: true,
          eveningDay: day,
          humans,
          bots,
        });
        this.live.add(game);
        count('evening_matches');
      } catch (err) {
        void reportError(err, 'evening start', { extra: { day, players: ids.length } });
        for (const id of ids) {
          this.io
            .to(`user:${id}`)
            .emit('notice', { kind: 'error', message: 'Вечерният Роял не можа да започне. Съжаляваме!' });
        }
      }
    }
  }

  /** Tells everyone in the lobby (and whoever just went from it into a match) how it stands. */
  private broadcast() {
    for (const userId of this.waiting) this.io.to(`user:${userId}`).emit('evening:status', this.status(userId)!);
  }
}
