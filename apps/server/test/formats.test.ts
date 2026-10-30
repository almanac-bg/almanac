// Picture and order questions („Подреди“): their scoring, where a match places them, how the engine plays them, and
// pictures in a host's own sets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, mock, test } from 'node:test';
import {
  CATEGORY_IDS,
  type GamePlayer,
  IMAGE,
  isOrder,
  ORDER,
  orderPoints,
  placedRight,
  type QuestionPayload,
  type RevealPayload,
  rightOrder,
  SETS,
} from '@quiz/shared';
import type { GameEmitter } from '../src/game/Game';
import type { OrderQuestion, PreparedQuestion } from '../src/questions';
import { app, jpeg, writeFixtureQuestions } from './helpers';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-formats-'));
process.env.DB_PATH = path.join(tmp, 'formats.db');
process.env.QUESTIONS_PATH = path.join(tmp, 'questions.json');
writeFixtureQuestions(process.env.QUESTIONS_PATH);

// Two picture questions and two order questions in every category, the pictures' files beside the bank.
const hex = (category: string, i: number) =>
  Buffer.from(`${category}${i}`).toString('hex').padEnd(16, '0').slice(0, 16);
fs.mkdirSync(path.join(tmp, 'images'));
const extra = CATEGORY_IDS.flatMap((category) =>
  [0, 1].flatMap((i) => {
    for (const name of [`${hex(category, i)}.webp`, `${hex(category, i)}-600.webp`])
      fs.writeFileSync(path.join(tmp, 'images', name), '');
    const difficulty = (['easy', 'medium'] as const)[i];
    return [
      {
        id: `${category}-p${i}`,
        category,
        difficulty,
        q: `Какво има на картина ${category} #${i}?`,
        options: ['Верен ✓', 'Грешен 1', 'Грешен 2', 'Грешен 3'],
        answer: 0,
        image: {
          file: `${hex(category, i)}.webp`,
          w: 1200,
          h: 900,
          alt: 'Нещо на снимка',
          credit: 'Иван Иванов',
          license: 'CC BY-SA',
          licenseVersion: '4.0',
          sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
        },
      },
      {
        id: `${category}-o${i}`,
        kind: 'order',
        category,
        difficulty,
        q: `Подреди ${category} #${i} от най-ранното:`,
        items: [
          { text: 'Трето', value: 1900 },
          { text: 'Първо', value: 1800 },
          { text: 'Четвърто', value: 1950 },
          { text: 'Второ', value: 1850 },
        ],
        direction: 'asc',
        ...(i === 0 && { fact: `Факт за подреждане ${category}.`, factSource: 'https://example.test/fact' }),
      },
    ];
  }),
);
const fixture = JSON.parse(fs.readFileSync(process.env.QUESTIONS_PATH, 'utf8'));
fs.writeFileSync(process.env.QUESTIONS_PATH, JSON.stringify([...fixture, ...extra]));

const { one, run } = await import('../src/db');
const { Game, gameClock } = await import('../src/game/Game');
gameClock.now = () => Date.now();
const {
  imageBank,
  isChoice,
  numberBank,
  orderBank,
  pickDuelSet,
  pickMatch,
  pickQuestions,
  pickRounds,
  questionImage,
  reorderOptions,
  seededRng,
} = await import('../src/questions');
const {
  hideSet,
  createSet,
  pictureAllowed,
  pictureFile,
  prepareSet,
  readPicture,
  saveSet,
  sweepPictures,
  uploadPicture,
} = await import('../src/sets');

const isPicture = (q: PreparedQuestion) => isChoice(q) && !!q.image;

// ─── Scoring ─────────────────────────────────────────────────────────────────

test('an order scores 250 for each thing in its place; all of it right adds the speed and streak bonus', () => {
  const right = rightOrder([1900, 1800, 1950, 1850], 'asc');
  assert.deepEqual(right, [1, 3, 0, 2]);
  assert.deepEqual(rightOrder([1900, 1800, 1950, 1850], 'desc'), [2, 0, 3, 1]);
  assert.equal(placedRight([1, 3, 0, 2], right), 4);
  assert.equal(placedRight([3, 1, 0, 2], right), 2, 'two swapped: the other two are in place');
  assert.equal(placedRight(null, right), 0);

  const at = (r: number, timeMs: number, streak = 1) =>
    orderPoints({ right: r, timeMs, limitMs: ORDER.timeMs, readMs: 2_000, streak });
  assert.equal(at(2, 1_000), 2 * ORDER.perItem, 'part of it: no speed bonus');
  assert.equal(at(4, 2_000), 4 * ORDER.perItem + ORDER.speed, 'all of it at once: the whole speed bonus');
  assert.equal(at(4, ORDER.timeMs), 4 * ORDER.perItem, 'at the bell: none');
  assert.equal(at(4, ORDER.timeMs, 3), 4 * ORDER.perItem + 100, 'the streak bonus as for any right answer');

  assert.ok(isOrder([2, 0, 3, 1]));
  for (const bad of [[0, 0, 1, 2], [0, 1, 2], [0, 1, 2, 4], [0, 1, 2, 1.5], 'nope', null])
    assert.ok(!isOrder(bad), JSON.stringify(bad));
});

// ─── The draw ────────────────────────────────────────────────────────────────

test('a match holds up to two pictures between Q2 and Q8 and one order in its second half, as its formats say', () => {
  for (let seed = 0; seed < 40; seed++) {
    const questions = pickMatch(10, 'mixed', new Map(), {
      final: true,
      formats: { images: 2, order: true },
      rng: seededRng(`draw-${seed}`),
    });
    assert.equal(questions.length, 10);
    assert.equal(questions.at(-1)!.kind, 'number', 'the final stays last');
    const pictures = questions.flatMap((q, i) => (isPicture(q) ? [i] : []));
    assert.equal(pictures.length, 2);
    for (const i of pictures) assert.ok(i >= IMAGE.first && i <= IMAGE.last, `a picture at ${i}`);
    const orders = questions.flatMap((q, i) => (q.kind === 'order' ? [i] : []));
    assert.equal(orders.length, 1);
    assert.ok(orders[0] >= 4 && orders[0] < 9, `the order at ${orders[0]}`);
    assert.equal(new Set(questions.map((q) => q.id)).size, 10, 'no question twice');
  }
  const plain = pickMatch(10, 'mixed', new Map(), { final: true });
  assert.ok(!plain.some((q) => isPicture(q) || q.kind === 'order'), 'none without formats (a room of the bank');
  const daily = pickMatch(10, 'mixed', new Map(), { final: true, formats: { images: 1, order: false } });
  assert.equal(daily.filter(isPicture).length, 1, 'the daily: one picture');
  assert.ok(!daily.some((q) => q.kind === 'order'));
});

test('pictures and orders seen in the last 30 days stay out; a short match has one picture at most', () => {
  const now = Date.now();
  const seen = new Map<string, number>(
    [...imageBank(), ...orderBank()].map((q) => [q.id, now - 5 * 24 * 60 * 60_000] as [string, number]),
  );
  const questions = pickMatch(10, 'mixed', seen, { final: true, formats: { images: 2, order: true }, now });
  assert.ok(!questions.some((q) => isPicture(q) || q.kind === 'order'), 'all of them recent: none come');
  const longAgo = new Map(seen);
  longAgo.set('history-p0', now - 40 * 24 * 60 * 60_000);
  const again = pickMatch(10, 'mixed', longAgo, { final: true, formats: { images: 2, order: true }, now });
  assert.deepEqual(
    again.filter(isPicture).map((q) => q.id),
    ['history-p0'],
  );
  const short = pickMatch(5, 'history', new Map(), { final: false, formats: { images: 2, order: true } });
  assert.equal(short.filter(isPicture).length, 1);
  assert.ok(
    short.filter((q) => q.kind === 'order' || isPicture(q)).every((q) => q.category === 'history'),
    'of the category',
  );
});

test('a number final seen in the last 30 days stays out, in Микс too: a question with options closes instead', () => {
  const now = Date.now();
  const recently = new Map<string, number>(numberBank().map((q) => [q.id, now - 5 * 24 * 60 * 60_000]));
  for (const category of ['mixed', 'history'] as const) {
    const questions = pickMatch(10, category, recently, { final: true, now });
    assert.equal(questions.length, 10);
    assert.ok(!questions.some((q) => q.kind === 'number'), category);
  }
  const plan = pickRounds(recently, seededRng('rounds-recent'), { now })!;
  assert.ok(isChoice(plan.questions.at(-1)!), 'a Дуел closes on a hard question');
  // One seen long enough ago comes back.
  const again = new Map(recently);
  const [old] = numberBank();
  again.set(old.id, now - 40 * 24 * 60 * 60_000);
  assert.equal(pickMatch(10, 'mixed', again, { final: true, now }).at(-1)!.id, old.id);
});

test('a room of pictures is all pictures as far as the bank has them, then questions with options', () => {
  const questions = pickMatch(10, 'history', new Map(), { final: false, pictures: true });
  assert.equal(questions.length, 10);
  assert.equal(questions.filter(isPicture).length, 2, 'history has two');
  assert.ok(questions.every((q) => q.category === 'history'));
});

test('in rounds: a picture in each of the first two rounds (never the opener), the order in the third', () => {
  for (let seed = 0; seed < 20; seed++) {
    const plan = pickRounds(new Map(), seededRng(`rounds-${seed}`), { formats: { images: 2, order: true } })!;
    assert.ok(plan);
    const [first, second, third] = plan.rounds;
    const round1 = plan.questions.slice(0, 3);
    assert.equal(round1.filter(isPicture).length, 1);
    assert.ok(!isPicture(round1[0]), 'not the first question of the match');
    for (const offer of second.offers) {
      assert.equal(offer.questions.filter(isPicture).length, 1, `round 2, ${offer.category}`);
      assert.ok(!offer.questions.some((q) => q.kind === 'order'));
    }
    for (const offer of third.offers) {
      assert.equal(offer.questions.filter((q) => q.kind === 'order').length, 1, `round 3, ${offer.category}`);
      assert.ok(!offer.questions.some(isPicture));
    }
    assert.equal(first.category, round1[0].category);
  }
  const duel = pickDuelSet(new Map(), [], seededRng('duel'), { formats: { images: 2, order: true } })!;
  assert.equal(duel.filter(isPicture).length, 2);
  assert.equal(duel.slice(6, 9).filter((q) => q.kind === 'order').length, 1);
  const plain = pickRounds(new Map(), seededRng('plain'))!;
  assert.ok(!plain.questions.some((q) => isPicture(q) || q.kind === 'order'));
});

test('an order question’s things are shuffled per player like options are, and its picture comes in two sizes', () => {
  const q = orderBank()[0];
  const shown = reorderOptions([q], 'player-1')[0] as OrderQuestion;
  assert.deepEqual(new Set(shown.items.map((i) => i.text)), new Set(q.items.map((i) => i.text)));
  assert.deepEqual(reorderOptions([q], 'player-1')[0], shown, 'the same seed, the same order');
  const picture = questionImage(imageBank()[0])!;
  assert.match(picture.src, /^\/qimg\/[0-9a-f]{16}-600\.webp$/);
  assert.match(picture.srcSet, /-600\.webp 600w, \/qimg\/[0-9a-f]{16}\.webp 1200w$/);
  assert.ok(!pickQuestions(300, 'mixed', new Map()).some(isPicture), 'the ordinary draw has no pictures');
});

// ─── The engine ──────────────────────────────────────────────────────────────

const COUNTDOWN = 3_500;
const TIME = 15_000;
const advance = (ms: number) => {
  for (let t = 0; t < ms; t += 50) mock.timers.tick(Math.min(50, ms - t));
};
const person = (id: number): GamePlayer => ({
  id: `u${id}`,
  userId: id,
  name: `u${id}`,
  level: 1,
  isBot: false,
  isGuest: false,
  rating: 1000,
  avatar: 'fox',
  frame: 'classic',
  title: 'rookie',
  team: null,
});

function play(questions: PreparedQuestion[], opts: { bots?: boolean; roomCode?: string | null } = {}) {
  const events: { to: string; event: string; payload: unknown }[] = [];
  const game = new Game(
    {
      mode: 'custom',
      ranked: false,
      roomCode: opts.roomCode ?? null,
      hostUserId: null,
      timeMs: TIME,
      category: 'mixed',
      elimination: false,
      teams: false,
      dailyDay: null,
      challengeId: null,
      questions,
      rounds: [],
      humans: [1, 2].map((id) => ({ player: person(id), powerups: ['fifty', 'double', 'retry'], emotes: [] })),
      bots: opts.bots
        ? [
            {
              player: { ...person(0), id: 'b1', userId: null, isBot: true },
              brain: { skill: 2000, pace: 0.3, strong: [], weak: [] },
            },
          ]
        : [],
    },
    {
      toGame: (event, ...args) => events.push({ to: 'game', event, payload: args[0] }),
      toUser: (userId, event, ...args) => events.push({ to: `u${userId}`, event, payload: args[0] }),
      toGameExcept: (_userId, event, ...args) => events.push({ to: 'game', event, payload: args[0] }),
    } satisfies GameEmitter,
    {
      finalize: () => new Map(),
      undelivered: () => {},
      release: () => {},
      progress: () => {},
      draining: () => false,
      crowd: () => null,
      shown: () => {},
      onClosed: () => {},
    },
  );
  game.start();
  advance(COUNTDOWN);
  const of = <T>(event: string) => events.filter((e) => e.event === event).map((e) => e.payload as T);
  return { game, events, of };
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  mock.method(Math, 'random', () => 0.5);
});
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

const text = () => pickQuestions(3, 'history', new Map());
const orderQ = () => reorderOptions([orderBank()[0]], 'game')[0] as OrderQuestion;
const pictureQ = () => reorderOptions([imageBank()[0]], 'game')[0];

test('an order question: its things go out without their numbers; the order comes back scored, with the answer', () => {
  const [a, b] = text();
  const order = orderQ();
  const { game, of } = play([a, order, b]);
  game.answer('u1', 0, isChoice(a) ? a.answer : 0);
  game.answer('u2', 0, isChoice(a) ? a.answer : 0);
  advance(600 + 4_000 + 100);
  const question = of<QuestionPayload>('game:question')[1];
  assert.equal(question.kind, 'order');
  assert.deepEqual(question.options, []);
  assert.deepEqual(
    question.order!.items,
    order.items.map((i) => i.text),
  );
  assert.ok(!JSON.stringify(question).includes('1800'), 'no values before the answer');
  assert.equal(question.durationMs, ORDER.timeMs, 'its own, longer clock');

  const right = rightOrder(
    order.items.map((i) => i.value),
    order.direction,
  );
  // A коз is refused on it.
  game.usePowerup('u1', 1, 'double');
  assert.equal(game.participants.get('u1')!.usedPowerups.size, 0);
  game.arrange('u1', 1, right);
  game.arrange('u2', 1, [right[1], right[0], right[2], right[3]]);
  game.arrange('u2', 1, right); // a second try is ignored
  advance(600 + 50);
  const reveal = of<RevealPayload>('game:reveal')[1];
  assert.deepEqual(reveal.answerOrder, { order: right, values: order.items.map((i) => i.value), unit: '' });
  assert.equal(reveal.correct, -1);
  assert.equal(reveal.results.u1.correct, true);
  assert.equal(reveal.results.u1.order!.right, 4);
  assert.ok(reveal.results.u1.points > 4 * ORDER.perItem, 'all right: the speed bonus too');
  assert.equal(reveal.results.u1.streak, 2, 'a streak goes on');
  assert.equal(reveal.results.u2.correct, false);
  assert.deepEqual(reveal.results.u2.order, { given: [right[1], right[0], right[2], right[3]], right: 2 });
  assert.equal(reveal.results.u2.points, 2 * ORDER.perItem);
  assert.equal(reveal.results.u2.streak, 0);
  const log = game.participants.get('u2')!.log[1];
  assert.equal(log.placed, 2);
  assert.equal(log.choice, null);
  assert.deepEqual(
    log.arranged!.map((i) => orderBank()[0].items[i].text),
    [right[1], right[0], right[2], right[3]].map((i) => order.items[i].text),
    'kept as the bank orders the things',
  );
});

test('malformed or late orders are refused; a bot puts the things in order too', () => {
  const order = orderQ();
  const { game, of } = play([order, ...text()], { bots: true });
  game.arrange('u1', 0, [0, 0, 1, 2]);
  game.arrange('u1', 0, 'nope');
  assert.equal(game.participants.get('u1')!.answer, null);
  game.arrange('u1', 1, [0, 1, 2, 3]);
  assert.deepEqual(of<{ reason: string }>('game:rejected')[0], { index: 1, reason: 'late' });
  advance(ORDER.timeMs + 400 + 100);
  const reveal = of<RevealPayload>('game:reveal')[0];
  assert.deepEqual(reveal.results.u1.order, { given: null, right: 0 });
  assert.equal(reveal.results.u1.points, 0);
  assert.equal(reveal.results.b1.order!.right, 4, 'a bot that knows it');
});

test('a picture: its two sizes go with the question, whose it is with the answer, and the next one ahead', () => {
  const [a, b] = text();
  const picture = pictureQ();
  const { game, of, events } = play([a, picture, b]);
  const start = events.find((e) => e.event === 'game:start')!.payload as { nextImage: unknown };
  assert.equal(start.nextImage, null, 'the first question has none');
  for (const id of ['u1', 'u2']) game.answer(id, 0, 0);
  advance(600 + 50);
  const first = of<RevealPayload>('game:reveal')[0];
  assert.deepEqual(first.nextImage, { src: questionImage(picture)!.src, srcSet: questionImage(picture)!.srcSet });
  assert.equal(first.credit, null);
  advance(4_000 + 100);
  const question = of<QuestionPayload>('game:question')[1];
  assert.deepEqual(question.image, questionImage(picture));
  assert.ok(!JSON.stringify(question).includes('Иван Иванов'), 'no credit before the answer');
  assert.equal(question.durationMs, IMAGE.timeMs, 'a shorter clock outside a room');
  assert.ok(question.readMs >= IMAGE.readExtraMs + 1_000, 'and a moment to take it in');
  for (const id of ['u1', 'u2']) game.answer(id, 1, 0);
  advance(600 + 50);
  const reveal = of<RevealPayload>('game:reveal')[1];
  assert.deepEqual(reveal.credit, {
    credit: 'Иван Иванов',
    license: 'CC BY-SA 4.0',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
  });
  const room = play([b, picture], { roomCode: '123456' });
  for (const id of ['u1', 'u2']) room.game.answer(id, 0, 0);
  advance(600 + 4_000 + 100);
  assert.equal(room.of<QuestionPayload>('game:question')[1].durationMs, TIME, 'in a room, the host’s clock');
});

// ─── A host's own sets ───────────────────────────────────────────────────────

/** The smallest WebP a canvas makes, of the given size (lossless, VP8L). */
function webp(w: number, h: number, extra = 0): Buffer {
  const b = Buffer.alloc(30 + extra);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WEBPVP8L', 8, 'latin1');
  b.writeUInt32LE(b.length - 20, 16);
  b[20] = 0x2f;
  b.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21);
  return b;
}

test('a set’s picture is a still WebP or JPEG of a sensible size; a photo’s metadata is taken out, a wrapper refused', () => {
  const plain = jpeg(640, 480);
  assert.deepEqual(readPicture(webp(800, 600)), { type: 'image/webp', w: 800, h: 600, bytes: webp(800, 600) });
  assert.deepEqual(readPicture(plain), { type: 'image/jpeg', w: 640, h: 480, bytes: plain });
  // Safari's canvas writes EXIF (APP1) and APP13; a photo's EXIF can say where it was taken: kept is the picture alone.
  const safari = jpeg(640, 480, [app(0xe1, 'Exif GPS'), app(0xed, 'Photoshop'), app(0xfe, 'comment')]);
  assert.deepEqual(readPicture(safari)?.bytes, plain, 'metadata and comments taken out');
  // Anything wrapped as a JPEG (a comment of bytes in a frame, no picture in it) is refused.
  const sof = [0xff, 0xc0, 0x00, 0x0b, 8, 0x01, 0xe0, 0x02, 0x80, 1, 1, 0x11, 0];
  const wrapper = Buffer.from([0xff, 0xd8, ...app(0xfe, 'anything at all'), ...sof, 0xff, 0xd9]);
  assert.equal(readPicture(wrapper), null);
  assert.equal(readPicture(Buffer.concat([plain.subarray(0, -10), Buffer.from([0xff, 0xd9])])), null, 'no scan');
  assert.equal(readPicture(webp(SETS.imageSide + 1, 600)), null, 'too big');
  assert.equal(readPicture(webp(8, 8)), null, 'too small');
  assert.equal(readPicture(webp(800, 600).subarray(0, 28)), null, 'cut short');
  assert.equal(readPicture(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
});

test('a host uploads pictures, saves them with a set, plays them; a moderator blocks them; unused ones go', () => {
  run(
    `INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES
     (11, 'teacher', 'teacher', 'x', 0), (12, 'other', 'other', 'x', 0)`,
  );
  const up = uploadPicture(11, webp(800, 600));
  assert.ok(up.ok);
  assert.deepEqual(uploadPicture(11, webp(800, 600)), up, 'the same picture twice is one');
  const spare = uploadPicture(11, webp(400, 300, 4));
  assert.ok(spare.ok);
  assert.equal(uploadPicture(11, Buffer.alloc(SETS.imageBytes + 1)).ok, false);

  const unknown = createSet(11, {
    name: 'Урок',
    questions: [
      { kind: 'truefalse', q: 'Това е крепост.', answer: true, image: { id: 'f'.repeat(16), w: 1, h: 1, alt: '' } },
    ],
  });
  assert.deepEqual(unknown, { ok: false, error: 'Въпрос 1: снимката я няма — сложи я отново.' });

  const made = createSet(11, {
    name: 'Урок 6',
    questions: [
      {
        kind: 'choice',
        q: 'Коя е тази крепост?',
        options: ['Царевец', 'Баба Вида', 'Асенова', 'Овеч'],
        answer: 0,
        // The size comes from the upload, not from what the editor says.
        image: { id: up.id, w: 5, h: 5, alt: 'Каменна крепост на хълм' },
      },
      {
        kind: 'order',
        q: 'Подреди от най-ранното:',
        items: [
          { text: 'Освобождението', value: 1878 },
          { text: 'Съединението', value: 1885 },
          { text: 'Независимостта', value: 1908 },
          { text: 'Балканската война', value: 1912 },
        ],
        unit: '',
      },
      {
        kind: 'order',
        q: 'Подреди стъпките:',
        items: [
          { text: 'Засяване', value: null },
          { text: 'Поливане', value: null },
          { text: 'Цъфтеж', value: null },
          { text: 'Беритба', value: null },
        ],
        unit: '',
      },
    ],
  });
  assert.ok(made.ok);
  const halfNumbered = saveSet(made.id, 11, {
    name: 'Урок 6',
    questions: [
      {
        kind: 'order',
        q: 'Подреди стъпките:',
        items: [
          { text: 'А', value: 1 },
          { text: 'Б', value: null },
          { text: 'В', value: 3 },
          { text: 'Г', value: 4 },
        ],
        unit: '',
      },
    ],
  });
  assert.ok(!halfNumbered.ok && /всичките четири/.test(halfNumbered.error));
  const backwards = saveSet(made.id, 11, {
    name: 'Урок 6',
    questions: [
      {
        kind: 'order',
        q: 'Подреди стъпките:',
        items: [
          { text: 'А', value: 1 },
          { text: 'Б', value: 5 },
          { text: 'В', value: 3 },
          { text: 'Г', value: 4 },
        ],
        unit: '',
      },
    ],
  });
  assert.ok(!backwards.ok, 'numbers that don’t go up or down in the host’s order');

  const played = prepareSet(made.id, 11)!;
  const [picture, numbered, plain] = played;
  assert.ok(isChoice(picture) && picture.image && 'url' in picture.image);
  // Shown by an address signed for a while: the bare one serves nothing.
  const shown = questionImage(picture)!;
  assert.match(shown.src, new RegExp(`^/api/sets/images/${up.id}\\?e=\\d+&s=[\\w-]{22}$`));
  assert.deepEqual([shown.w, shown.h, shown.alt], [800, 600, 'Каменна крепост на хълм']);
  const [e, sig] = [...shown.src.matchAll(/[?&][es]=([^&]+)/g)].map((m) => m[1]);
  assert.ok(pictureAllowed(up.id, e, sig));
  assert.equal(pictureAllowed(up.id, e, `${sig.slice(0, -1)}A`), false, 'signed');
  assert.equal(pictureAllowed(up.id, String(Number(e) + 3600), sig), false, 'for this expiry');
  assert.equal(pictureAllowed(up.id, e, sig, Number(e) * 1000 + 1), false, 'until it');
  assert.equal(numbered.kind, 'order');
  assert.equal(plain.kind, 'order');
  if (numbered.kind !== 'order' || plain.kind !== 'order') return;
  assert.deepEqual(
    rightOrder(
      numbered.items.map((i) => i.value),
      numbered.direction,
    ).map((i) => numbered.items[i].text),
    ['Освобождението', 'Съединението', 'Независимостта', 'Балканската война'],
  );
  assert.ok(!numbered.hideValues);
  assert.deepEqual(
    rightOrder(
      plain.items.map((i) => i.value),
      plain.direction,
    ).map((i) => plain.items[i].text),
    ['Засяване', 'Поливане', 'Цъфтеж', 'Беритба'],
    'without numbers, the host’s order',
  );
  assert.ok(plain.hideValues, 'and no numbers to show');

  // Another host's copy uses the same picture; a moderator hides the set: the picture isn't served anywhere, isn't
  // taken again from anyone, and the set can't be changed.
  const code = one<{ code: string }>('SELECT code FROM question_sets WHERE id = ?', made.id)!.code;
  assert.ok(hideSet(code, true));
  assert.equal(pictureFile(up.id), undefined);
  assert.equal(prepareSet(made.id, 11), null, 'a hidden set isn’t played');
  assert.deepEqual(uploadPicture(12, webp(800, 600)), { ok: false, error: 'Тази снимка е спряна от модератор.' });
  assert.match(String((saveSet(made.id, 11, { name: 'Урок 6', questions: [] }) as { error: string }).error), /скрит/);
  assert.ok(hideSet(code, false));
  assert.ok(pictureFile(up.id), 'shown again: served again');

  // A day on, the picture no set uses goes; the one in the set stays.
  assert.equal(sweepPictures(Date.now() + 25 * 60 * 60_000), 1);
  assert.ok(one('SELECT 1 AS x FROM set_images WHERE id = ?', up.id));
  assert.ok(!one('SELECT 1 AS x FROM set_images WHERE id = ?', spare.ok ? spare.id : ''));
  assert.equal(sweepPictures(Date.now() + 25 * 60 * 60_000), 0, 'once a day: the next run that day reads no sets');
});
