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
import proxyaddr from 'proxy-addr';
import { Server } from 'socket.io';
import { hashToken, resolveSession, sessionTokenFromCookieHeader } from './auth';
import { challengeQuestions, claimChallengeAttempt, createChallenge, releaseChallengeAttempt } from './challenges';
import { config } from './config';
import { claimDailyAttempt, dailyQuestions, guestDailyQuestions, releaseDailyAttempt } from './daily';
import { friendIds, incomingRequests } from './friends';
import type { IO } from './game/io';
import { Matchmaker } from './game/matchmaking';
import { buildHuman, GameRegistry } from './game/registry';
import { Rematches } from './game/rematch';
import { RoomManager } from './game/rooms';
import { guarded } from './guard';
import { ACCOUNT_ONLY } from './guests';
import { reportError } from './monitoring';
import { friendsChanged, notifyUser, setRealtime } from './notify';
import { eventBucket, network, throttled } from './throttle';
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
const obj = (x: unknown): Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};

const MAX_SOCKETS_PER_USER = 10;
/**
 * Every per-account limit is really per guest, and a guest is one click away, so one network gets a ceiling too: high,
 * because a mobile operator puts thousands of phones behind one IPv4 address.
 */
const MAX_SOCKETS_PER_NETWORK = 300;

/** Shown while the server restarts for an update. */
const DRAINING = 'Обновяваме играта — нови мачове може да започнат след минута-две.';

export interface Realtime {
  io: IO;
  activeGames: () => number;
  /**
   * Stops new matches and empties the queues, then resolves once running matches have finished. Any still running after
   * `maxMs` end there, with the scores so far, so nobody's match vanishes without a result.
   */
  drain: (maxMs: number) => Promise<void>;
}

/** `trustProxy`: Express's compiled "trust proxy" rule, so a socket's address is worked out exactly like `req.ip`. */
export function createRealtime(httpServer: HttpServer, trustProxy: (addr: string, i: number) => boolean): Realtime {
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
  const socketsByNetwork = new Map<string, number>();
  const games = new GameRegistry(io);
  // Someone online and free to join a queue (not in a match, a queue or a room): a reason to wait for a person.
  const idleOnline = () => {
    let n = 0;
    for (const userId of openSockets.keys())
      if (!games.forUser(userId) && !matchmaker.modeOf(userId) && !rooms.roomOf(userId)) n++;
    return n;
  };
  const matchmaker: Matchmaker = new Matchmaker(io, games, idleOnline);
  const rooms = new RoomManager(io, games, (userId) => openSockets.has(userId));
  /** Set when the server is shutting down for an update. */
  let draining = false;
  const rematches = new Rematches(
    io,
    games,
    matchmaker,
    () => !draining,
    (userId) => openSockets.has(userId),
  );

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
    modes: config.openQueues,
    build: config.webBuild,
  });
  // Every 3 s, but only when something changed: a quiet lobby (and every phone in a match) isn't woken for nothing. A new
  // connection gets the figures at once (below).
  let lastStats = '';
  setInterval(
    guarded('lobby stats', () => {
      const now = stats();
      const key = JSON.stringify(now);
      if (key === lastStats) return;
      lastStats = key;
      io.emit('lobby:stats', now);
    }),
    3000,
  ).unref();

  io.use((socket, next) => {
    const token = sessionTokenFromCookieHeader(socket.request.headers.cookie);
    const userId = resolveSession(token)?.userId;
    if (!token || !userId || !getUser(userId)) return next(new Error('unauthorized'));
    // A handful of tabs is normal; dozens of sockets for one account is not.
    if ((openSockets.get(userId) ?? 0) >= MAX_SOCKETS_PER_USER) return next(new Error('too-many-connections'));
    const net = network(proxyaddr(socket.request, trustProxy));
    if ((socketsByNetwork.get(net) ?? 0) >= MAX_SOCKETS_PER_NETWORK) return next(new Error('too-many-connections'));
    socket.data.network = net;
    socket.data.userId = userId;
    socket.data.session = hashToken(token);
    next();
  });

  io.on('connection', (socket) => {
    const { userId, session } = socket.data;
    socketsByNetwork.set(socket.data.network, (socketsByNetwork.get(socket.data.network) ?? 0) + 1);
    socket.join([`user:${userId}`, `session:${session}`]);
    // Bursts are fine (answer + joker + emote); a stream of events is dropped — with an answer for any that wait for
    // one, so the page says "too fast" rather than "no connection".
    const allowed = eventBucket();
    socket.use((packet, next) => {
      if (allowed()) return next();
      const ack = packet.at(-1);
      if (typeof ack === 'function') ack({ ok: false, error: 'Твърде бързо — изчакай секунда.' });
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
          void reportError(err, `socket ${event}`, { userId });
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
    const busyError = () => (games.forUser(userId) ? 'Вече си в мач.' : draining ? DRAINING : null);
    /** Guests play; friends, rooms of their own and challenge links wait until they claim the account. */
    const guest = () => getUser(userId)?.is_guest === 1;
    /** Going on to something new: off the queue, and any rematch offer from the last match is declined. */
    const moveOn = () => {
      matchmaker.leave(userId);
      rematches.cancelFor(userId);
    };

    on('queue:join', (mode, ack) => {
      if (!isQueueMode(mode)) return reply(ack, { ok: false, error: 'Непознат режим.' });
      if (!config.openQueues.includes(mode)) {
        const open = config.openQueues.map((m) => `„${MODES[m].name}“`).join(' или ');
        return reply(ack, { ok: false, error: `Този режим ще се отвори скоро — дотогава опитай ${open}.` });
      }
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      rooms.leave(userId);
      rematches.cancelFor(userId);
      matchmaker.join(userId, mode);
      reply(ack, { ok: true });
    });

    on('queue:leave', () => matchmaker.leave(userId));

    on('solo:start', (opts, ack) => {
      const { category } = obj(opts);
      if (!isCategoryChoice(category)) return reply(ack, { ok: false, error: 'Непозната категория.' });
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      moveOn();
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
      moveOn();
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
          questions: guest() ? guestDailyQuestions(userId) : dailyQuestions(claim.day, userId),
          humans: [buildHuman(userId, 'daily')],
          bots: [],
        });
        reply(ack, { ok: true });
      } catch (err) {
        releaseDailyAttempt(userId, claim.day);
        reply(ack, { ok: false, error: err instanceof Error ? err.message : 'Играта не можа да започне.' });
      }
    });

    on('challenge:start', (p, ack) => {
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      let id = str(obj(p).id, 16);
      if (!id) {
        if (guest()) return reply(ack, { ok: false, error: ACCOUNT_ONLY });
        if (throttled(`challenge-create:${userId}`, 20, 24 * 60 * 60_000)) {
          return reply(ack, { ok: false, error: 'Стига предизвикателства за днес — изпрати тези, които вече имаш.' });
        }
        id = createChallenge(userId);
      }
      const claim = claimChallengeAttempt(id, userId);
      if (!claim.ok) return reply(ack, claim);
      moveOn();
      rooms.leave(userId);
      try {
        games.start({
          mode: 'challenge',
          ranked: false,
          roomCode: null,
          hostUserId: null,
          questionCount: MODES.challenge.questions,
          timeMs: MODES.challenge.timeMs,
          category: 'mixed',
          elimination: false,
          challengeId: id,
          questions: challengeQuestions(id, userId),
          humans: [buildHuman(userId, 'challenge')],
          bots: [],
        });
        reply(ack, { ok: true, id });
      } catch (err) {
        releaseChallengeAttempt(id, userId);
        reply(ack, { ok: false, error: err instanceof Error ? err.message : 'Играта не можа да започне.' });
      }
    });

    on('room:create', (settings, ack) => {
      if (guest()) return reply(ack, { ok: false, error: ACCOUNT_ONLY });
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      moveOn();
      reply(ack, rooms.create(userId, obj(settings)));
    });

    on('room:join', (code, ack) => {
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      // Codes are short enough to type; this keeps them too slow to guess (per player, and per network: guests are free).
      if (
        throttled(`room-join:${userId}`, 20, 10 * 60_000) ||
        throttled(`room-join-net:${socket.data.network}`, 120, 10 * 60_000)
      ) {
        return reply(ack, { ok: false, error: 'Твърде много опити да влезеш в стая. Изчакай няколко минути.' });
      }
      moveOn();
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

    on('invite:send', (p, ack) =>
      reply(ack, guest() ? { ok: false, error: ACCOUNT_ONLY } : rooms.invite(userId, int(obj(p).userId))),
    );

    on('invite:decline', (p) => {
      const from = rooms.declineInvite(userId, str(obj(p).inviteId, 64));
      const me = publicUser(userId);
      if (from && me) notifyUser(from, 'notice', { kind: 'info', message: `${me.username} отказа поканата.` });
    });

    on('friends:challenge', (p, ack) => {
      if (guest()) return reply(ack, { ok: false, error: ACCOUNT_ONLY });
      const busy = busyError();
      if (busy) return reply(ack, { ok: false, error: busy });
      moveOn();
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
      if (game && POWERUP_IDS.includes(powerup as PowerupId))
        game.usePowerup(game.playerIdFor(userId), int(index), powerup as PowerupId);
    });

    on('game:react', (emote) => {
      const game = games.forUser(userId);
      if (game) game.react(game.playerIdFor(userId), str(emote, 16));
    });

    on('rematch:request', (p) => rematches.request(userId, str(obj(p).gameId, 64)));
    on('rematch:decline', (p) => rematches.decline(userId, str(obj(p).gameId, 64)));

    on('game:leave', () => {
      const game = games.forUser(userId);
      if (game?.setup.roomCode) rooms.leave(userId);
      games.leave(userId);
    });

    socket.on('disconnect', () => {
      const onNetwork = (socketsByNetwork.get(socket.data.network) ?? 1) - 1;
      if (onNetwork > 0) socketsByNetwork.set(socket.data.network, onNetwork);
      else socketsByNetwork.delete(socket.data.network);
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
      games.startDraining();
      for (const userId of matchmaker.clear()) notifyUser(userId, 'notice', { kind: 'info', message: DRAINING });
      io.emit('server:draining', { message: DRAINING });
      await games.idle(maxMs);
      // A moment for the results to reach the players before the connections close.
      if (games.stopAll() > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    },
  };
}
