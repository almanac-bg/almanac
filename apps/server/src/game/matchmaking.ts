import { randomUUID } from 'node:crypto';
import { type AckResult, MODES, QUEUE_MODES, type QueueModeId, type TeamId } from '@quiz/shared';
import { config } from '../config';
import { areFriends } from '../friends';
import { guarded } from '../guard';
import { reportError } from '../monitoring';
import { friendsChanged, notifyUser } from '../notify';
import { pickRecord } from '../records';
import { count } from '../stats';
import { getUser, publicUser } from '../users';
import { makeBots } from './bots';
import type { IO } from './io';
import { averageOf, balanceTeams, buildHuman, type GameRegistry } from './registry';

/** A player's first few multiplayer matches get kinder bots: the first win comes sooner. */
const NEWCOMER_GAMES = 3;

/** Who waits together: one player, or (Отбори) two friends who play on one team. */
interface Party {
  userIds: number[];
  joinedAt: number;
}

/** The wait for bots when the player is the only one around: long enough to read who's coming, no longer. */
const ALONE_FILL_MS = 1_500;

/** How long an invite to play Отбори together stands. */
const DUO_INVITE_MS = 60_000;

/** Отбори is played by pairs of friends: two on a team, against another pair (or two bots). */
const DUO = 2;

interface DuoInvite {
  from: number;
  to: number;
  expiresAt: number;
}

/**
 * First-come-first-served queues per mode. Bots fill the gaps after `config.botFillMs` — or `config.botFillBusyMs`
 * while someone else who could join is online (`idleOnline`: online, not in a match or a queue): when few people
 * play, an 8-second window almost never brings two of them together. With nobody else around: ALONE_FILL_MS.
 * A mode with `minPlayers` (Арена) starts with the people who came once the wait is up, bots only making up its
 * minimum. Отбори queues pairs: two pairs make a match, a pair alone plays two bots.
 */
export class Matchmaker {
  private queues = Object.fromEntries(QUEUE_MODES.map((m) => [m, [] as Party[]])) as Record<QueueModeId, Party[]>;
  /**
   * Who's in which queue, rebuilt after the queues change (changed()): modeOf is asked for every online player each
   * second (idleOnline, presence), and a scan of every party per player held the event loop for tens of ms at scale.
   */
  private where: Map<number, QueueModeId> | null = null;
  private duoInvites = new Map<string, DuoInvite>();

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

  /** Puts a player — or a pair, for Отбори — in a queue (out of any other first). */
  join(userIds: number[], mode: QueueModeId) {
    for (const userId of userIds) this.leave(userId, false);
    this.queues[mode].push({ userIds, joinedAt: Date.now() });
    this.changed();
    friendsChanged(...userIds);
    this.tick();
  }

  /** Out of the queue — and so is whoever was waiting with them (told why). */
  leave(userId: number, notify = true) {
    for (const mode of QUEUE_MODES) {
      const q = this.queues[mode];
      const i = q.findIndex((p) => p.userIds.includes(userId));
      if (i === -1) continue;
      const [party] = q.splice(i, 1);
      this.changed();
      this.broadcast(mode);
      friendsChanged(...party.userIds);
      for (const mate of party.userIds.filter((id) => id !== userId)) {
        this.io.to(`user:${mate}`).emit('queue:status', null);
        const name = getUser(userId)?.username;
        this.io
          .to(`user:${mate}`)
          .emit('notice', { kind: 'info', message: `${name ?? 'Съотборникът ти'} излезе от опашката.` });
      }
    }
    if (notify) this.io.to(`user:${userId}`).emit('queue:status', null);
  }

  /** Empties every queue (the server is about to restart). Returns who was waiting. */
  clear(): number[] {
    const waiting = QUEUE_MODES.flatMap((mode) => this.queues[mode].splice(0).flatMap((p) => p.userIds));
    this.changed();
    for (const userId of waiting) this.io.to(`user:${userId}`).emit('queue:status', null);
    friendsChanged(...waiting);
    return waiting;
  }

  modeOf(userId: number): QueueModeId | null {
    if (!this.where) {
      this.where = new Map();
      for (const mode of QUEUE_MODES)
        for (const party of this.queues[mode]) for (const id of party.userIds) this.where.set(id, mode);
    }
    return this.where.get(userId) ?? null;
  }

  /** The queues changed: who's where is worked out again when next asked. */
  private changed() {
    this.where = null;
  }

  /** Players waiting in each queue. */
  counts(): Record<QueueModeId, number> {
    return Object.fromEntries(QUEUE_MODES.map((m) => [m, waiting(this.queues[m])])) as Record<QueueModeId, number>;
  }

  sendStatus(userId: number) {
    const mode = this.modeOf(userId);
    if (mode) this.broadcast(mode);
  }

  // ─── Отбори: playing with a friend ────────────────────────────────────────

  /** Asks an online friend to play Отбори together; they join the queue as a pair once they say yes. */
  inviteDuo(fromId: number, toId: number, online: (userId: number) => boolean): AckResult {
    if (!areFriends(fromId, toId)) return { ok: false, error: 'Отбори се играе с приятел.' };
    if (!online(toId)) return { ok: false, error: 'Приятелят ти не е онлайн.' };
    if (this.games.forUser(toId)) return { ok: false, error: 'Приятелят ти е в мач — опитай след малко.' };
    const now = Date.now();
    for (const [id, invite] of this.duoInvites) if (invite.expiresAt < now) this.duoInvites.delete(id);
    const id = randomUUID();
    this.duoInvites.set(id, { from: fromId, to: toId, expiresAt: now + DUO_INVITE_MS });
    notifyUser(toId, 'invite', {
      id,
      from: publicUser(fromId)!,
      kind: 'duo',
      roomCode: null,
      expiresAt: now + DUO_INVITE_MS,
    });
    return { ok: true };
  }

  /** The invited friend's answer: who asked them, if the invite is theirs and still stands (it's used up either way). */
  takeDuoInvite(userId: number, inviteId: string): number | null {
    const invite = this.duoInvites.get(inviteId);
    if (!invite || invite.to !== userId) return null;
    this.duoInvites.delete(inviteId);
    return invite.expiresAt < Date.now() ? null : invite.from;
  }

  /** How long the queues wait for people before bots fill in; null with bots off. */
  private fillMs(): number | null {
    if (config.botFillMs === null) return null;
    const queued = QUEUE_MODES.reduce((n, m) => n + waiting(this.queues[m]), 0);
    // Nobody else is queued, and nobody online could join: waiting would only keep them waiting.
    // idleOnline walks everyone online: only asked when its answer matters, and at most once.
    let idle: number | undefined;
    const idleNow = () => (idle ??= this.idleOnline());
    if (queued <= DUO && idleNow() === 0) return Math.min(config.botFillMs, ALONE_FILL_MS);
    if (config.botFillBusyMs === config.botFillMs || queued === 0) return config.botFillMs;
    return idleNow() > 0 ? config.botFillBusyMs : config.botFillMs;
  }

  private tick() {
    const now = Date.now();
    const fill = this.fillMs();
    for (const mode of QUEUE_MODES) {
      const q = this.queues[mode];
      const seats = MODES[mode].players;
      // Two pairs (Отбори), or a full match of players.
      const full = () => (MODES[mode].teams ? q.length >= 2 : waiting(q) >= seats);
      while (full()) {
        const parties = MODES[mode].teams ? q.splice(0, 2) : q.splice(0, seats);
        this.changed();
        this.launch(mode, parties);
      }
      if (q.length > 0 && fill !== null && now - q[0].joinedAt >= fill) {
        const parties = MODES[mode].teams ? q.splice(0, 1) : q.splice(0, seats);
        this.changed();
        this.launch(mode, parties);
      }
      this.broadcast(mode, fill);
    }
  }

  /**
   * A ranked match for exactly these players (bots fill the other seats), e.g. a rematch. Each inner list is a party:
   * in Отбори, a pair that plays on one team.
   */
  startWith(mode: QueueModeId, parties: number[][]) {
    for (const userId of parties.flat()) this.leave(userId);
    this.launch(
      mode,
      parties.map((userIds) => ({ userIds, joinedAt: Date.now() })),
    );
  }

  private launch(mode: QueueModeId, parties: Party[]) {
    const def = MODES[mode];
    const userIds = parties.flatMap((p) => p.userIds);
    for (const userId of userIds) this.io.to(`user:${userId}`).emit('queue:status', null);
    try {
      const humans = userIds.map((userId) => buildHuman(userId, mode));
      const gentle = userIds.some((userId) => (getUser(userId)?.mp_games ?? 0) < NEWCOMER_GAMES);
      // Alone in a Дуел: a recording of a real player's match, when one fits (a newcomer's first ones stay gentle bots).
      const record =
        mode === 'duel' && humans.length === 1 && !gentle ? pickRecord(userIds[0], humans[0].player.rating) : null;
      if (record) {
        this.games.start({
          mode,
          ranked: true,
          roomCode: null,
          hostUserId: null,
          questionCount: def.questions,
          timeMs: def.timeMs,
          category: 'mixed',
          elimination: false,
          questions: record.questions,
          rounds: record.rounds,
          records: [{ player: record.player, script: record.script, runId: record.runId, ownerId: record.ownerId }],
          humans,
          bots: [],
        });
        count('record_matches');
        return;
      }
      // Bots take the seats nobody did — or, where a match may start smaller (Арена), only up to its minimum.
      const seats = def.minPlayers ? Math.max(def.minPlayers, humans.length) : def.players;
      const bots = makeBots(
        seats - humans.length,
        averageOf(humans),
        humans.map((h) => h.player.name),
        { gentle },
      );
      if (def.teams) {
        // Each pair is a team; a pair alone plays the bots.
        const teamOf = new Map(parties.flatMap((p, i) => p.userIds.map((id) => [id, i as TeamId])));
        if (parties.every((p) => p.userIds.length === DUO)) {
          for (const h of humans) h.player.team = teamOf.get(h.player.userId!)!;
          for (const b of bots) b.player.team = 1;
        } else balanceTeams([...humans, ...bots]);
      }
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
      for (const userId of userIds) {
        this.io
          .to(`user:${userId}`)
          .emit('notice', { kind: 'error', message: 'Мачът не можа да започне. Опитай пак.' });
      }
    }
  }

  private broadcast(mode: QueueModeId, fill = this.fillMs()) {
    const q = this.queues[mode];
    if (q.length === 0) return;
    const now = Date.now();
    const found = waiting(q);
    for (const party of q) {
      for (const userId of party.userIds) {
        this.io.to(`user:${userId}`).emit('queue:status', {
          mode,
          found,
          needed: MODES[mode].players,
          waitedMs: now - party.joinedAt,
          botFillMs: fill === null ? null : Math.max(0, fill - (now - q[0].joinedAt)),
          with: party.userIds
            .filter((id) => id !== userId)
            .map((id) => getUser(id)?.username)
            .filter((name): name is string => !!name),
        });
      }
    }
  }
}

const waiting = (q: Party[]) => q.reduce((n, p) => n + p.userIds.length, 0);
