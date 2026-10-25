import type { Server as HttpServer } from 'node:http';
import {
  type AckResult,
  type ClientToServerEvents,
  isCategoryChoice,
  isQueueMode,
  type LobbyStats,
  MODES,
  POWERUPS,
  type PowerupId,
  type Presence,
} from '@quiz/shared';
import { Server } from 'socket.io';
import { hashToken, resolveSession, sessionTokenFromCookieHeader } from './auth';
import { claimDailyAttempt, dailyQuestions } from './daily';
import { friendIds, incomingRequests } from './friends';
import type { IO } from './game/io';
import { Matchmaker } from './game/matchmaking';
import { buildHuman, GameRegistry } from './game/registry';
import { RoomManager } from './game/rooms';
import { guarded } from './guard';
import { friendsChanged, notifyUser, setRealtime } from './notify';
import { eventBucket, throttled } from './throttle';
import { getUser, publicUser } from './users';

const POWERUP_IDS = POWERUPS.map((p) => p.id);

function reply<T extends object>(ack: unknown, result: AckResult<T>) {
  if (typeof ack === 'function') ack(result);
}

// Client payloads are untrusted JSON and are checked by type, never coerced: `String(x)` / `Number(x)` run code chosen
// by the sender's payload shape (`{"toString": 1}` throws).
const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
/** -1 for anything but a whole number: no player, question or option has that id. */
const int = (x: unknown) => (Number.isSafeInteger(x) ? (x as number) : -1);
const obj = (x: unknown): Record<string, unknown> => (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

const MAX_SOCKETS_PER_USER = 10;

/** Shown while the server restarts for an update. */
const DRAINING = 'Обновяваме играта — нови мачове може да започнат след минута-две.';

export interface Realtime {
  io: IO;
  activeGames: () => number;
  /** Stops new matches and empties the queues, then resolves once running matches have finished (or after `maxMs`). */
  drain: (maxMs: number) => Promise<void>;
}

export function createRealtime(httpServer: HttpServer): Realtime {
  const io: IO = new Server(httpServer, {
    serveClient: false,
    // Every client message is tiny; the 1 MB default only invites abuse.
    maxHttpBufferSize: 16 * 1024,
    // Only same-origin pages may open a socket (blocks cross-site socket hijacking with the session cookie).
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      cb(null, !origin || URL.parse(origin)?.host === req.headers.host);
    },
  });
  const openSockets = new Map<number, number>();
  const games = new GameRegistry(io);
  const matchmaker = new Matchmaker(io, games);
  const rooms = new RoomManager(io, games, (userId) => openSockets.has(userId));
  /** Set when the server is shutting down for an update. */
  let draining = false;

  const presenceOf = (userId: number): Presence => {
    if (!openSockets.has(userId)) return 'offline';
    if (games.forUser(userId)) return 'game';
    if (rooms.roomOf(userId)) return 'room';
    if (matchmaker.modeOf(userId)) return 'queue';
    return 'online';
  };
  setRealtime(io, presenceOf, friendIds, incomingRequests, (userId) => {
    matchmaker.leave(userId, false);
    rooms.leave(userId);
    games.leave(userId);
  });

  const stats = (): LobbyStats => ({
    online: openSockets.size,
    inGame: games.playersInGame,
    queues: matchmaker.counts(),
  });
  setInterval(guarded('lobby stats', () => io.emit('lobby:stats', stats())), 3000).unref();

  io.use((socket, next) => {
    const token = sessionTokenFromCookieHeader(socket.request.headers.cookie);
    const userId = resolveSession(token)?.userId;
    if (!token || !userId || !getUser(userId)) return next(new Error('unauthorized'));
    // A handful of tabs is normal; dozens of sockets for one account is not.
    if ((openSockets.get(userId) ?? 0) >= MAX_SOCKETS_PER_USER) return next(new Error('too-many-connections'));
    socket.data.userId = userId;
    socket.data.session = hashToken(token);
    next();
  });

  io.on('connection', (socket) => {
    const { userId, session } = socket.data;
    socket.join([`user:${userId}`, `session:${session}`]);
    // Bursts are fine (answer + joker + emote); a stream of events is dropped.
    const allowed = eventBucket();
    socket.use((_packet, next) => {
      if (allowed()) next();
    });

    /**
     * Every client event goes through here: a handler that throws (a bug, or a payload nobody anticipated) answers
     * that one request with an error instead of taking the whole server — and every live match — down with it.
     */
    const on = <E extends keyof ClientToServerEvents>(event: E, listener: ClientToServerEvents[E]) => {
      socket.on(event, ((...args: unknown[]) => {
        try {
          (listener as (...a: unknown[]) => void)(...args);
        } catch (err) {
          console.error(`💥 socket "${event}" from user ${userId}:`, err);
          const ack = args.at(-1);
          if (typeof ack === 'function') ack({ ok: false, error: 'Нещо се обърка. Опитай пак.' });
        }
      }) as never);
    };
    const firstSocket = !openSockets.has(userId);
    openSockets.set(userId, (openSockets.get(userId) ?? 0) + 1);
    if (firstSocket) friendsChanged(userId);

    // Bring a reconnecting player back into whatever they were doing.
    const current = games.forUser(userId);
    if (current) {
      const playerId = current.playerIdFor(userId);
      socket.join(`game:${current.id}`);
      current.setConnected(playerId, true);
      const sync = current.syncFor(playerId);
      socket.emit('game:start', sync.start);
      if (sync.question) socket.emit('game:question', sync.question);
    } else {
      // The match ended while they were away: show how it went (it's already saved).
      const missed = games.takeMissed(userId);
      if (missed) {
        socket.emit('game:start', missed.start);
        socket.emit('game:end', missed.end);
      }
    }
    rooms.connected(userId, socket);
    matchmaker.sendStatus(userId);
    socket.emit('lobby:stats', stats());
    if (draining) socket.emit('server:draining', { message: DRAINING });

    // Starting anything new is refused while the server drains for a restart.
    const busyError = () => (games.forUser(userId) ? 'Вече си в игра.' : draining ? DRAINING : null);

    on('queue:join', (mode, ack) => {
      if (!isQueueMode(mode)) return reply(ack, { ok: false, error: 'Непознат режим.' });
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      rooms.leave(userId);
      matchmaker.join(userId, mode);
      reply(ack, { ok: true });
    });

    on('queue:leave', () => matchmaker.leave(userId));

    on('solo:start', (opts, ack) => {
      const { category } = obj(opts);
      if (!isCategoryChoice(category)) return reply(ack, { ok: false, error: 'Непозната категория.' });
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      matchmaker.leave(userId);
      rooms.leave(userId);
      try {
        games.start({
          mode: 'solo',
          ranked: false,
          roomCode: null,
          hostUserId: null,
          questionCount: MODES.solo.questions,
          timeMs: MODES.solo.timeMs,
          category,
          elimination: false,
          humans: [buildHuman(userId, 'solo')],
          bots: [],
        });
        reply(ack, { ok: true });
      } catch (err) {
        reply(ack, { ok: false, error: err instanceof Error ? err.message : 'Играта не можа да започне.' });
      }
    });

    on('daily:start', (ack) => {
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      const claim = claimDailyAttempt(userId);
      if (!claim.ok) return reply(ack, claim);
      matchmaker.leave(userId);
      rooms.leave(userId);
      try {
        games.start({
          mode: 'daily',
          ranked: false,
          roomCode: null,
          hostUserId: null,
          questionCount: MODES.daily.questions,
          timeMs: MODES.daily.timeMs,
          category: 'mixed',
          elimination: false,
          dailyDay: claim.day,
          questions: dailyQuestions(claim.day, userId),
          humans: [buildHuman(userId, 'daily')],
          bots: [],
        });
        reply(ack, { ok: true });
      } catch (err) {
        reply(ack, { ok: false, error: err instanceof Error ? err.message : 'Играта не можа да започне.' });
      }
    });

    on('room:create', (settings, ack) => {
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      matchmaker.leave(userId);
      reply(ack, rooms.create(userId, obj(settings)));
    });

    on('room:join', (code, ack) => {
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      // Codes are short enough to type; this keeps them too slow to guess.
      if (throttled(`room-join:${userId}`, 20, 10 * 60_000)) {
        return reply(ack, { ok: false, error: 'Твърде много опити да влезеш в стая. Изчакай няколко минути.' });
      }
      matchmaker.leave(userId);
      reply(ack, rooms.join(userId, str(code, 10)));
    });

    on('room:leave', () => rooms.leave(userId));
    on('room:settings', (settings) => rooms.updateSettings(userId, obj(settings)));
    on('room:bot', (action) => {
      if (action === 'add' || action === 'remove') rooms.bot(userId, action);
    });
    on('room:kick', (playerId) => rooms.kick(userId, str(playerId, 32)));
    on('room:team', (playerId) => rooms.switchTeam(userId, str(playerId, 32)));
    on('room:start', (ack) => reply(ack, draining ? { ok: false, error: DRAINING } : rooms.start(userId)));

    on('invite:send', (p, ack) => reply(ack, rooms.invite(userId, int(obj(p).userId))));

    on('invite:decline', (p) => {
      const from = rooms.declineInvite(userId, str(obj(p).inviteId, 64));
      const me = publicUser(userId);
      if (from && me) notifyUser(from, 'notice', { kind: 'info', message: `${me.username} отказа поканата.` });
    });

    on('friends:challenge', (p, ack) => {
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      matchmaker.leave(userId);
      reply(ack, rooms.challenge(userId, int(obj(p).userId)));
    });

    on('game:answer', (p) => {
      const game = games.forUser(userId);
      const { index, choice } = obj(p);
      if (game) game.answer(game.playerIdFor(userId), int(index), int(choice));
    });

    on('game:powerup', (p) => {
      const game = games.forUser(userId);
      const { index, powerup } = obj(p);
      if (game && POWERUP_IDS.includes(powerup as PowerupId)) game.usePowerup(game.playerIdFor(userId), int(index), powerup as PowerupId);
    });

    on('game:react', (emote) => {
      const game = games.forUser(userId);
      if (game) game.react(game.playerIdFor(userId), str(emote, 16));
    });

    on('game:leave', () => {
      const game = games.forUser(userId);
      if (game?.setup.roomCode) rooms.leave(userId);
      games.leave(userId);
    });

    socket.on('disconnect', () => {
      const remaining = (openSockets.get(userId) ?? 1) - 1;
      if (remaining > 0) {
        openSockets.set(userId, remaining);
        return;
      }
      openSockets.delete(userId);
      matchmaker.leave(userId, false);
      rooms.disconnected(userId);
      const game = games.forUser(userId);
      if (game) game.setConnected(game.playerIdFor(userId), false);
      friendsChanged(userId);
    });
  });

  return {
    io,
    activeGames: () => games.activeGames,
    async drain(maxMs) {
      draining = true;
      for (const userId of matchmaker.clear()) notifyUser(userId, 'notice', { kind: 'info', message: DRAINING });
      io.emit('server:draining', { message: DRAINING });
      await games.idle(maxMs);
    },
  };
}
