import type { Server as HttpServer } from 'node:http';
import {
  type AckResult,
  isCategoryChoice,
  isQueueMode,
  type LobbyStats,
  MODES,
  POWERUPS,
  type PowerupId,
  type Presence,
} from '@quiz/shared';
import { Server } from 'socket.io';
import { userIdFromCookieHeader } from './auth';
import { claimDailyAttempt, dailyQuestions } from './daily';
import { friendIds } from './friends';
import type { IO } from './game/io';
import { Matchmaker } from './game/matchmaking';
import { buildHuman, GameRegistry } from './game/registry';
import { RoomManager } from './game/rooms';
import { friendsChanged, notifyUser, setRealtime } from './notify';
import { getUser, publicUser } from './users';

const POWERUP_IDS = POWERUPS.map((p) => p.id);

function reply<T extends object>(ack: unknown, result: AckResult<T>) {
  if (typeof ack === 'function') ack(result);
}

export function createRealtime(httpServer: HttpServer): IO {
  const io: IO = new Server(httpServer, {
    serveClient: false,
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

  const presenceOf = (userId: number): Presence => {
    if (!openSockets.has(userId)) return 'offline';
    if (games.forUser(userId)) return 'game';
    if (rooms.roomOf(userId)) return 'room';
    if (matchmaker.modeOf(userId)) return 'queue';
    return 'online';
  };
  setRealtime(io, presenceOf, friendIds, (userId) => {
    matchmaker.leave(userId, false);
    rooms.leave(userId);
    games.leave(userId);
  });

  const stats = (): LobbyStats => ({
    online: openSockets.size,
    inGame: games.playersInGame,
    queues: matchmaker.counts(),
  });
  setInterval(() => io.emit('lobby:stats', stats()), 3000).unref();

  io.use((socket, next) => {
    const userId = userIdFromCookieHeader(socket.request.headers.cookie);
    if (!userId || !getUser(userId)) return next(new Error('unauthorized'));
    socket.data.userId = userId;
    next();
  });

  io.on('connection', (socket) => {
    const { userId } = socket.data;
    socket.join(`user:${userId}`);
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
    }
    rooms.connected(userId, socket);
    matchmaker.sendStatus(userId);
    socket.emit('lobby:stats', stats());

    const busyError = () => (games.forUser(userId) ? 'Вече си в игра.' : null);

    socket.on('queue:join', (mode, ack) => {
      if (!isQueueMode(mode)) return reply(ack, { ok: false, error: 'Непознат режим.' });
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      rooms.leave(userId);
      matchmaker.join(userId, mode);
      reply(ack, { ok: true });
    });

    socket.on('queue:leave', () => matchmaker.leave(userId));

    socket.on('solo:start', (opts, ack) => {
      const category = opts?.category;
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

    socket.on('daily:start', (ack) => {
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
          questions: dailyQuestions(claim.day),
          humans: [buildHuman(userId, 'daily')],
          bots: [],
        });
        reply(ack, { ok: true });
      } catch (err) {
        reply(ack, { ok: false, error: err instanceof Error ? err.message : 'Играта не можа да започне.' });
      }
    });

    socket.on('room:create', (settings, ack) => {
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      matchmaker.leave(userId);
      reply(ack, rooms.create(userId, settings ?? {}));
    });

    socket.on('room:join', (code, ack) => {
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      matchmaker.leave(userId);
      reply(ack, rooms.join(userId, String(code ?? '')));
    });

    socket.on('room:leave', () => rooms.leave(userId));
    socket.on('room:settings', (settings) => rooms.updateSettings(userId, settings ?? {}));
    socket.on('room:bot', (action) => {
      if (action === 'add' || action === 'remove') rooms.bot(userId, action);
    });
    socket.on('room:kick', (playerId) => rooms.kick(userId, String(playerId)));
    socket.on('room:team', (playerId) => rooms.switchTeam(userId, String(playerId)));
    socket.on('room:start', (ack) => reply(ack, rooms.start(userId)));

    socket.on('invite:send', (p, ack) => reply(ack, rooms.invite(userId, Number(p?.userId))));

    socket.on('invite:decline', (p) => {
      const from = Number(p?.fromUserId);
      const me = publicUser(userId);
      if (from && me) notifyUser(from, 'notice', { kind: 'info', message: `${me.username} отказа поканата.` });
    });

    socket.on('friends:challenge', (p, ack) => {
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      matchmaker.leave(userId);
      reply(ack, rooms.challenge(userId, Number(p?.userId)));
    });

    socket.on('game:answer', (p) => {
      const game = games.forUser(userId);
      if (game && p) game.answer(game.playerIdFor(userId), Number(p.index), Number(p.choice));
    });

    socket.on('game:powerup', (p) => {
      const game = games.forUser(userId);
      if (game && p && POWERUP_IDS.includes(p.powerup)) game.usePowerup(game.playerIdFor(userId), Number(p.index), p.powerup as PowerupId);
    });

    socket.on('game:react', (emote) => {
      const game = games.forUser(userId);
      if (game) game.react(game.playerIdFor(userId), String(emote));
    });

    socket.on('game:leave', () => {
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

  return io;
}
