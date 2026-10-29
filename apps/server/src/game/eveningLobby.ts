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

  constructor(
    private io: IO,
    private games: GameRegistry,
    private isOnline: (userId: number) => boolean,
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
      const over = now >= startsAt && (this.startedFor === day ? this.live.size === 0 : true);
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

  private tick() {
    const now = this.now();
    const day = dayKey(now);
    const startsAt = eveningStartsAt(day);
    if (startsAt === null || this.startedFor === day || now < startsAt) return;
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
            .emit('notice', { kind: 'error', message: 'Вечерният Роял не можа да започне. Извинявай!' });
        }
      }
    }
  }

  /** Tells everyone in the lobby (and whoever just went from it into a match) how it stands. */
  private broadcast() {
    for (const userId of this.waiting) this.io.to(`user:${userId}`).emit('evening:status', this.status(userId)!);
  }
}
