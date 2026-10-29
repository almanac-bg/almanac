// The realtime client's own logic, against a stand-in for the socket: what the screen believes after a reconnect, a
// pick that never reached the server, a link that died without saying so, a leave that crossed a reconnect. The
// server's side of the same moments is in apps/server/test/e2e.test.ts.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { beforeEach, mock, test } from 'node:test';
import type { GamePlayer, GameStartPayload, QuestionPayload, Standing } from '@quiz/shared';

class FakeManager extends EventEmitter {
  delayMs = 1000;
  jitter = 0.5;
  reconnectionDelay(ms: number) {
    this.delayMs = ms;
    return this;
  }
  randomizationFactor(jitter: number) {
    this.jitter = jitter;
    return this;
  }
}

/** The socket the client gets: records what it sends; `deliver` plays the server. */
class FakeSocket extends EventEmitter {
  connected = false;
  sendBuffer: unknown[] = [];
  sent: [string, ...unknown[]][] = [];
  /** The link died without a word: emits pile up in the buffer, as Socket.IO's do while it waits for a ping. */
  stalled = false;
  /** The connection manager underneath, where the server's pings arrive (and its reconnection pace is set). */
  io = new FakeManager();
  private catchAll: ((event: string, ...args: unknown[]) => void)[] = [];

  onAny(listener: (event: string, ...args: unknown[]) => void) {
    this.catchAll.push(listener);
    return this;
  }

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
    for (const listener of this.catchAll) listener(event, ...args);
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
  pace: 'normal',
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
  rounds: [],
  duelWith: null,
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
  kind: 'choice',
  options: ['А', 'Б', 'В', 'Г'],
  number: null,
  order: null,
  image: null,
  final: false,
  author: null,
  durationMs: 15_000,
  remainingMs: 15_000,
  speedMs: 15_000,
  readMs: 2_000,
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

beforeEach(async () => {
  run++;
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 + run * 3_600_000 });
  socket.stalled = false;
  socket.sendBuffer = [];
  socket.sent = [];
  setState({ game: null, toasts: [], connected: false });
  await connectRealtime();
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

test('back after the link died, the player hears how many questions went by', () => {
  inMatch();
  socket.deliver('game:question', question(3));
  assert.deepEqual(toasts(), ['Докато нямаше връзка, минаха 2 въпроса.']);
  socket.deliver('game:question', question(4));
  assert.deepEqual(toasts(), ['Докато нямаше връзка, минаха 2 въпроса.'], 'the next one in turn is no news');
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
        guess: null,
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
    // One toast, not one per try (it leaves when the screen's time for it runs out: see Toasts).
    const once = ['Играта е отворена в твърде много раздели.'];
    assert.deepEqual(told, [once, once, once]);
  } finally {
    socket.connect = FakeSocket.prototype.connect;
  }
});

test('a number goes out once, locks the question and comes back in the review with how close it was', () => {
  inMatch();
  const number = question(1, {
    kind: 'number',
    options: [],
    number: { unit: 'г.', min: 1000, max: 2025, step: 1, scale: 'linear' },
    final: true,
  });
  socket.deliver('game:question', number);
  actions.answer(0);
  actions.guess(1878);
  actions.guess(1900);
  assert.deepEqual(socket.sent, [['game:guess', { index: 1, value: 1878 }]], 'no option to pick; one number');
  assert.deepEqual([game().myChoice, game().myGuess], [-1, 1878]);
  socket.deliver('game:reveal', {
    index: 1,
    correct: -1,
    answerNumber: 1878,
    results: {
      u1: {
        choice: null,
        correct: true,
        points: 1250,
        timeMs: 6000,
        streak: 1,
        doubled: false,
        retried: false,
        number: { guess: 1878, closeness: 1 },
      },
    },
    standings: [standing('u1'), standing('b1')],
    eliminated: [],
    nextInMs: 4000,
    fact: null,
  });
  assert.deepEqual(game().history.at(-1)!.number, {
    answer: 1878,
    unit: 'г.',
    step: 1,
    scale: 'linear',
    guess: 1878,
    closeness: 1,
  });
});

test('a round is picked by whoever is asked, once; everyone sees what it became', () => {
  const first = start({
    gameId: `g${run}`,
    rounds: [
      { from: 0, size: 3, category: 'history', pickedBy: null },
      { from: 3, size: 3, category: null, pickedBy: null },
    ],
  });
  socket.deliver('game:start', first);
  socket.deliver('game:pick', {
    round: 1,
    pickerId: 'u1',
    options: ['music', 'sports', 'nature'],
    durationMs: 5000,
    remainingMs: 4000,
  });
  assert.equal(game().phase, 'pick');
  assert.equal(game().pick!.endsAt, Date.now() + 4000);
  actions.pickCategory('sports');
  actions.pickCategory('music');
  assert.deepEqual(socket.sent, [['game:pick', { round: 1, category: 'sports' }]]);
  socket.deliver('game:round', { round: 1, category: 'sports', pickedBy: 'u1', startsInMs: 2000 });
  assert.equal(game().rounds[1].category, 'sports');
  assert.equal(game().pick!.chosen, 'sports');
  socket.deliver('game:question', question(3));
  assert.equal(game().pick, null);

  // Someone else's pick: nothing to send.
  socket.deliver('game:pick', {
    round: 2,
    pickerId: 'b1',
    options: ['music', 'general', 'nature'],
    durationMs: 5000,
    remainingMs: 5000,
  });
  actions.pickCategory('music');
  assert.equal(socket.sent.length, 1);
});

test('a restart the server announced: the tab comes back at a random moment in the first seconds, then as usual', () => {
  socket.connect();
  socket.deliver('server:draining', { message: 'Обновяваме играта.' });
  assert.equal(getState().maintenance, 'Обновяваме играта.');
  assert.deepEqual([socket.io.delayMs, socket.io.jitter], [2500, 1], 'anywhere from 0 to 5 s, not all in one second');
  socket.drop();
  socket.connect();
  assert.deepEqual([socket.io.delayMs, socket.io.jitter], [1000, 0.5], 'back in: a later drop retries as usual');
});
