// The realtime client's own logic, against a stand-in for the socket: what the screen believes after a reconnect, a
// pick that never reached the server, a link that died without saying so, a leave that crossed a reconnect. The
// server's side of the same moments is in apps/server/test/e2e.test.ts.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { beforeEach, mock, test } from 'node:test';
import type { GamePlayer, GameStartPayload, QuestionPayload, Standing } from '@quiz/shared';

/** The socket the client gets: records what it sends; `deliver` plays the server. */
class FakeSocket extends EventEmitter {
  connected = false;
  sendBuffer: unknown[] = [];
  sent: [string, ...unknown[]][] = [];
  /** The link died without a word: emits pile up in the buffer, as Socket.IO's do while it waits for a ping. */
  stalled = false;

  connect() {
    this.connected = true;
    super.emit('connect');
    return this;
  }
  disconnect() {
    this.drop('io client disconnect');
    return this;
  }
  drop(reason = 'transport close') {
    this.connected = false;
    super.emit('disconnect', reason);
  }
  // Sending, as the client sees it: Socket.IO's emit goes to the server, never to the client's own handlers.
  emit(event: string, ...args: unknown[]) {
    if (this.stalled || !this.connected) this.sendBuffer.push([event, ...args]);
    else this.sent.push([event, ...args]);
    return true;
  }
  timeout() {
    return {
      emitWithAck: async (event: string, ...args: unknown[]) => {
        this.sent.push([event, ...args]);
        return { ok: true };
      },
    };
  }
  deliver(event: string, ...args: unknown[]) {
    super.emit(event, ...args);
  }
  sentNames() {
    return this.sent.map(([event]) => event);
  }
}

const socket = new FakeSocket();
mock.module('socket.io-client', { namedExports: { io: () => socket } });
const { actions, connectRealtime, getState, setState } = await import('../src/index.ts');

const player = (id: string, name: string): GamePlayer => ({
  id,
  userId: id.startsWith('u') ? Number(id.slice(1)) : null,
  name,
  level: 3,
  isBot: id.startsWith('b'),
  isGuest: false,
  rating: 1000,
  team: null,
  avatar: 'fox',
  frame: 'classic',
  title: 'rookie',
});
const standing = (id: string): Standing => ({
  id,
  score: 0,
  correct: 0,
  streak: 0,
  rank: 1,
  eliminatedAt: null,
  left: false,
  connected: true,
});
const start = (over: Partial<GameStartPayload> = {}): GameStartPayload => ({
  gameId: 'g1',
  mode: 'duel',
  ranked: true,
  roomCode: null,
  players: [player('u1', 'Ана'), player('b1', 'Бот')],
  youId: 'u1',
  totalQuestions: 10,
  timeMs: 15_000,
  category: 'mixed',
  teams: false,
  eliminationSchedule: [],
  powerups: ['fifty'],
  usedPowerups: [],
  emotes: [],
  standings: [standing('u1'), standing('b1')],
  startsInMs: 3000,
  ...over,
});
const question = (index: number, over: Partial<QuestionPayload> = {}): QuestionPayload => ({
  id: `q${index}`,
  index,
  total: 10,
  category: 'history',
  difficulty: 'easy',
  q: `Въпрос ${index}?`,
  options: ['А', 'Б', 'В', 'Г'],
  author: null,
  durationMs: 15_000,
  remainingMs: 15_000,
  elimination: false,
  answered: [],
  ...over,
});
const game = () => getState().game!;
const toasts = () => getState().toasts.map((t) => t.title);

// The client remembers some things across matches (the match you left, when it last said "offline"): each test gets
// its own match and its own stretch of time.
let run = 0;

/** A match on its first question, connected; what the server would re-send for it after a reconnect. */
function inMatch() {
  const first = start({ gameId: `g${run}` });
  socket.deliver('game:start', first);
  socket.deliver('game:question', question(0));
  assert.equal(game().phase, 'question');
  return { ...first, startsInMs: 0 };
}

beforeEach(() => {
  run++;
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 + run * 3_600_000 });
  socket.stalled = false;
  socket.sendBuffer = [];
  socket.sent = [];
  setState({ game: null, toasts: [], connected: false });
  connectRealtime();
});

test('a pick goes out once and shows as yours', () => {
  inMatch();
  actions.answer(1);
  actions.answer(2);
  assert.deepEqual(socket.sent, [['game:answer', { index: 0, choice: 1 }]]);
  assert.equal(game().myChoice, 1);
});

test('offline, a pick is not sent (and not replayed later): the player is told', () => {
  inMatch();
  socket.drop();
  assert.equal(getState().connected, false);
  actions.answer(1);
  assert.deepEqual(socket.sent, []);
  assert.deepEqual(socket.sendBuffer, []);
  assert.equal(game().myChoice, null);
  assert.deepEqual(toasts(), ['Отговорът не е изпратен.']);
});

test('a link that died silently: the pick stays out of the buffer and off the screen', () => {
  inMatch();
  socket.stalled = true;
  actions.answer(3);
  assert.deepEqual(socket.sendBuffer, [], 'not left to replay after the reconnect');
  assert.equal(game().myChoice, null);
  assert.deepEqual(toasts(), ['Отговорът не е изпратен.']);
});

test('after a reconnect the question stays locked until the server says it is still open', () => {
  const again = inMatch();
  actions.answer(1);
  socket.drop();
  socket.connect();
  socket.deliver('game:start', again);
  assert.equal(game().resyncing, true);
  actions.answer(2);
  assert.equal(socket.sentNames().filter((e) => e === 'game:answer').length, 1, 'no pick while resyncing');

  // The server never got the pick: the screen unlocks it and says so, with the time the server counts.
  socket.deliver(
    'game:question',
    question(0, {
      remainingMs: 6000,
      mine: {
        choice: null,
        removed: [],
        doubled: false,
        retryArmed: false,
        retryPrompt: false,
        extraMs: 0,
        frozenMs: 0,
        powerupThisQuestion: false,
      },
    }),
  );
  assert.equal(game().resyncing, false);
  assert.equal(game().myChoice, null);
  assert.equal(game().deadline, Date.now() + 6000);
  assert.deepEqual(toasts(), ['Отговорът ти не стигна до сървъра.']);
});

test('a question that closed while we were away is not left open on screen', () => {
  const again = inMatch();
  socket.drop();
  socket.connect();
  socket.deliver('game:start', again);
  mock.timers.tick(999);
  assert.equal(game().phase, 'question');
  mock.timers.tick(1);
  assert.equal(game().phase, 'reveal');
  assert.equal(game().question, null);
  assert.equal(game().resyncing, false);
});

test('a match the server no longer has after a reconnect is closed, with a word why', () => {
  inMatch();
  socket.drop();
  socket.connect();
  mock.timers.tick(2499);
  assert.ok(getState().game);
  mock.timers.tick(1);
  assert.equal(getState().game, null);
  assert.deepEqual(toasts(), ['Мачът беше прекъснат.']);
});

test('a leave that crossed a reconnect is made again when the server re-sends the match', () => {
  const again = inMatch();
  actions.leaveGame();
  assert.equal(getState().game, null);
  socket.deliver('game:start', again);
  assert.equal(getState().game, null);
  assert.deepEqual(socket.sentNames(), ['game:leave', 'game:leave']);
  // A new match is a new match.
  socket.deliver('game:start', start({ gameId: 'another' }));
  assert.equal(game().start.gameId, 'another');
});

test('a pick the server turned down unlocks, with the reason', () => {
  inMatch();
  actions.answer(1);
  socket.deliver('game:rejected', { index: 0, reason: 'late' });
  assert.equal(game().myChoice, null);
  assert.deepEqual(toasts(), ['Отговорът ти пристигна след края на времето.']);
  // One for another question is old news.
  actions.answer(2);
  socket.deliver('game:rejected', { index: 5, reason: 'late' });
  assert.equal(game().myChoice, 2);
});

test('one tab too many: the player is told once why, and it keeps trying', () => {
  socket.drop();
  let tries = 0;
  socket.connect = function () {
    tries++;
    return this;
  };
  try {
    const told: string[][] = [];
    for (let i = 0; i < 3; i++) {
      socket.deliver('connect_error', new Error('too-many-connections'));
      told.push(toasts());
      mock.timers.tick(10_000);
    }
    assert.equal(tries, 3);
    assert.deepEqual(told, [['Играта е отворена в твърде много раздели.'], [], []]);
  } finally {
    socket.connect = FakeSocket.prototype.connect;
  }
});
