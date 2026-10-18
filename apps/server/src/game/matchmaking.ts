import { MODES, QUEUE_MODES, type QueueModeId } from '@quiz/shared';
import type { IO } from './io';
import { config } from '../config';
import { friendsChanged } from '../notify';
import { makeBots } from './bots';
import { averageOf, balanceTeams, buildHuman, type GameRegistry } from './registry';

interface Entry {
  userId: number;
  joinedAt: number;
}

/** First-come-first-served queues per mode; bots fill the gaps after `config.botFillMs`. */
export class Matchmaker {
  private queues = Object.fromEntries(QUEUE_MODES.map((m) => [m, [] as Entry[]])) as Record<QueueModeId, Entry[]>;

  constructor(
    private io: IO,
    private games: GameRegistry,
  ) {
    setInterval(() => this.tick(), 1000).unref();
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

  private tick() {
    const now = Date.now();
    for (const mode of QUEUE_MODES) {
      const q = this.queues[mode];
      const needed = MODES[mode].players;
      while (q.length >= needed) this.launch(mode, q.splice(0, needed));
      if (q.length > 0 && config.botFillMs !== null && now - q[0].joinedAt >= config.botFillMs) {
        this.launch(mode, q.splice(0, needed));
      }
      this.broadcast(mode);
    }
  }

  private launch(mode: QueueModeId, entries: Entry[]) {
    const def = MODES[mode];
    const humans = entries.map((e) => buildHuman(e.userId, mode));
    for (const e of entries) this.io.to(`user:${e.userId}`).emit('queue:status', null);
    const bots = makeBots(def.players - humans.length, averageOf(humans), humans.map((h) => h.player.name));
    if (def.teams) balanceTeams([...humans, ...bots]);
    try {
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
      console.error('Failed to start match', err);
      for (const e of entries) {
        this.io.to(`user:${e.userId}`).emit('notice', { kind: 'error', message: 'Мачът не можа да започне. Опитай пак.' });
      }
    }
  }

  private broadcast(mode: QueueModeId) {
    const q = this.queues[mode];
    const now = Date.now();
    for (const e of q) {
      this.io.to(`user:${e.userId}`).emit('queue:status', {
        mode,
        found: q.length,
        needed: MODES[mode].players,
        waitedMs: now - e.joinedAt,
        botFillMs: config.botFillMs === null ? null : Math.max(0, config.botFillMs - (now - q[0].joinedAt)),
      });
    }
  }
}
