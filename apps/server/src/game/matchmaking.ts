import { MODES, QUEUE_MODES, type QueueModeId } from '@quiz/shared';
import { config } from '../config';
import { guarded } from '../guard';
import { reportError } from '../monitoring';
import { friendsChanged } from '../notify';
import { getUser } from '../users';
import { makeBots } from './bots';
import type { IO } from './io';
import { averageOf, balanceTeams, buildHuman, type GameRegistry } from './registry';

/** A player's first few multiplayer matches get kinder bots: the first win comes sooner. */
const NEWCOMER_GAMES = 3;

interface Entry {
  userId: number;
  joinedAt: number;
}

/** The wait for bots when the player is the only one around: long enough to read who's coming, no longer. */
const ALONE_FILL_MS = 1_500;

/**
 * First-come-first-served queues per mode. Bots fill the gaps after `config.botFillMs` — or `config.botFillBusyMs`
 * while someone else who could join is online (`idleOnline`: online, not in a match or a queue): when few people
 * play, an 8-second window almost never brings two of them together. With nobody else around: ALONE_FILL_MS.
 */
export class Matchmaker {
  private queues = Object.fromEntries(QUEUE_MODES.map((m) => [m, [] as Entry[]])) as Record<QueueModeId, Entry[]>;

  constructor(
    private io: IO,
    private games: GameRegistry,
    private idleOnline: () => number,
  ) {
    setInterval(
      guarded('matchmaking', () => this.tick()),
      1000,
    ).unref();
  }

  join(userId: number, mode: QueueModeId) {
    this.leave(userId, false);
    this.queues[mode].push({ userId, joinedAt: Date.now() });
    friendsChanged(userId);
    this.tick();
  }

  leave(userId: number, notify = true) {
    for (const mode of QUEUE_MODES) {
      const q = this.queues[mode];
      const i = q.findIndex((e) => e.userId === userId);
      if (i === -1) continue;
      q.splice(i, 1);
      this.broadcast(mode);
      friendsChanged(userId);
    }
    if (notify) this.io.to(`user:${userId}`).emit('queue:status', null);
  }

  /** Empties every queue (the server is about to restart). Returns who was waiting. */
  clear(): number[] {
    const waiting = QUEUE_MODES.flatMap((mode) => this.queues[mode].splice(0).map((e) => e.userId));
    for (const userId of waiting) this.io.to(`user:${userId}`).emit('queue:status', null);
    friendsChanged(...waiting);
    return waiting;
  }

  modeOf(userId: number): QueueModeId | null {
    return QUEUE_MODES.find((m) => this.queues[m].some((e) => e.userId === userId)) ?? null;
  }

  counts(): Record<QueueModeId, number> {
    return Object.fromEntries(QUEUE_MODES.map((m) => [m, this.queues[m].length])) as Record<QueueModeId, number>;
  }

  sendStatus(userId: number) {
    const mode = this.modeOf(userId);
    if (mode) this.broadcast(mode);
  }

  /** How long the queues wait for people before bots fill in; null with bots off. */
  private fillMs(): number | null {
    if (config.botFillMs === null) return null;
    const queued = QUEUE_MODES.reduce((n, m) => n + this.queues[m].length, 0);
    // Nobody else is queued, and nobody online could join: waiting would only keep the one player waiting.
    if (queued <= 1 && this.idleOnline() === 0) return Math.min(config.botFillMs, ALONE_FILL_MS);
    if (config.botFillBusyMs === config.botFillMs || queued === 0) return config.botFillMs;
    return this.idleOnline() > 0 ? config.botFillBusyMs : config.botFillMs;
  }

  private tick() {
    const now = Date.now();
    const fill = this.fillMs();
    for (const mode of QUEUE_MODES) {
      const q = this.queues[mode];
      const needed = MODES[mode].players;
      while (q.length >= needed) this.launch(mode, q.splice(0, needed));
      if (q.length > 0 && fill !== null && now - q[0].joinedAt >= fill) {
        this.launch(mode, q.splice(0, needed));
      }
      this.broadcast(mode, fill);
    }
  }

  /** A ranked match for exactly these players (bots fill the other seats), e.g. a rematch. */
  startWith(mode: QueueModeId, userIds: number[]) {
    for (const userId of userIds) this.leave(userId);
    this.launch(
      mode,
      userIds.map((userId) => ({ userId, joinedAt: Date.now() })),
    );
  }

  private launch(mode: QueueModeId, entries: Entry[]) {
    const def = MODES[mode];
    for (const e of entries) this.io.to(`user:${e.userId}`).emit('queue:status', null);
    try {
      const humans = entries.map((e) => buildHuman(e.userId, mode));
      const gentle = entries.some((e) => (getUser(e.userId)?.mp_games ?? 0) < NEWCOMER_GAMES);
      const bots = makeBots(
        def.players - humans.length,
        averageOf(humans),
        humans.map((h) => h.player.name),
        { gentle },
      );
      if (def.teams) balanceTeams([...humans, ...bots]);
      this.games.start({
        mode,
        ranked: true,
        roomCode: null,
        hostUserId: null,
        questionCount: def.questions,
        timeMs: def.timeMs,
        category: 'mixed',
        elimination: def.elimination,
        teams: def.teams,
        humans,
        bots,
      });
    } catch (err) {
      void reportError(err, 'match start', { extra: { mode } });
      for (const e of entries) {
        this.io
          .to(`user:${e.userId}`)
          .emit('notice', { kind: 'error', message: 'Мачът не можа да започне. Опитай пак.' });
      }
    }
  }

  private broadcast(mode: QueueModeId, fill = this.fillMs()) {
    const q = this.queues[mode];
    if (q.length === 0) return;
    const now = Date.now();
    for (const e of q) {
      this.io.to(`user:${e.userId}`).emit('queue:status', {
        mode,
        found: q.length,
        needed: MODES[mode].players,
        waitedMs: now - e.joinedAt,
        botFillMs: fill === null ? null : Math.max(0, fill - (now - q[0].joinedAt)),
      });
    }
  }
}
