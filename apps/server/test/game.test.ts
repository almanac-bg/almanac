// The match engine on its own, on a mocked clock: leaving, dropped connections, abandoned matches and scoring rules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, mock, test } from 'node:test';
import {
  answerPoints,
  type CategoryId,
  type FinalStanding,
  type GamePlayer,
  NUMBER,
  type PickPayload,
  type PowerupId,
  type QuestionPayload,
  type RevealPayload,
  type RoundPayload,
  readingMs,
} from '@quiz/shared';
import type { GameEmitter, RecordScript } from '../src/game/Game';
import type { PreparedQuestion } from '../src/questions';
import { writeFixtureQuestions } from './helpers';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-game-'));
process.env.DB_PATH = path.join(tmp, 'game.db');
process.env.QUESTIONS_PATH = path.join(tmp, 'questions.json');
writeFixtureQuestions(process.env.QUESTIONS_PATH);
const { Game, gameClock } = await import('../src/game/Game');
// The match's clock follows the mocked Date (mock.timers can't mock performance.now).
gameClock.now = () => Date.now();
const { isChoice, numberBank, pickQuestions, pickRounds } = await import('../src/questions');
const { BOT_MAX_RATING, makeBots } = await import('../src/game/bots');

const COUNTDOWN = 3_500;
/** Moves the mocked clock in small steps, so timers set by other timers fire too. */
const advance = (ms: number) => {
  for (let t = 0; t < ms; t += 50) mock.timers.tick(Math.min(50, ms - t));
};
const TIME = 10_000;

const player = (id: string, userId: number | null): GamePlayer => ({
  id,
  userId,
  name: id,
  level: 1,
  isBot: userId === null,
  isGuest: false,
  rating: 1000,
  avatar: 'fox',
  frame: 'classic',
  title: 'rookie',
  team: null,
});

/**
 * Bots that always answer right ('strong') or always wrong ('weak') once Math.random is pinned to 0.5. A weak one gets
 * an unplayed easy question right 43% of the time, a medium one 19% (expectedRight at 750 against 800 and 1000), a
 * quarter of that by guessing: it knows the easy one 24% of the time, the medium one never.
 */
const bot = (id: string, kind: 'strong' | 'weak', favourites: { strong?: CategoryId[]; rating?: number } = {}) => ({
  player: { ...player(id, null), rating: favourites.rating ?? 1000, strong: favourites.strong ?? [] },
  brain: { skill: kind === 'strong' ? 2000 : 750, pace: 0.3, strong: favourites.strong ?? [], weak: [] },
});

function setup(opts: {
  humans: number[];
  bots?: ReturnType<typeof bot>[];
  elimination?: boolean;
  powerups?: PowerupId[];
  /** A daily run (one attempt). */
  daily?: boolean;
  /** Stay in the countdown (don't play up to the first question). */
  countdown?: boolean;
  /** Its questions (else ten picked from the fixture bank). */
  questions?: PreparedQuestion[];
  /** Played in rounds, as a Дуел is (a plan drawn here, or this one). */
  rounds?: true | NonNullable<ReturnType<typeof pickRounds>>;
  /** People's ratings, by user id (1000 otherwise). */
  ratings?: Record<number, number>;
  /** Recordings of real players' matches to play against. */
  records?: { player: GamePlayer; script: RecordScript; runId: number; ownerId: number }[];
  /** A room's host running it on a big screen, by user id. */
  presenter?: number;
  /** A number final's weight (a set made before it counted double: 1). */
  finalTimes?: number;
}) {
  const plan = opts.rounds === true ? pickRounds(new Map())! : (opts.rounds ?? null);
  const shown: string[][] = [];
  const events: { to: string; event: string; payload: unknown }[] = [];
  let standings: FinalStanding[] | null = null;
  const missed: number[] = [];
  let released = 0;
  let draining = false;
  const game = new Game(
    {
      mode: opts.daily ? 'daily' : 'custom',
      ranked: false,
      roomCode: null,
      hostUserId: null,
      timeMs: TIME,
      category: 'mixed',
      elimination: opts.elimination ?? false,
      teams: false,
      dailyDay: opts.daily ? '2026-10-26' : null,
      challengeId: null,
      questions: plan?.questions ?? opts.questions ?? pickQuestions(10, 'mixed', new Map()),
      rounds: plan?.rounds ?? [],
      humans: opts.humans.map((id) => ({
        player: { ...player(`u${id}`, id), rating: opts.ratings?.[id] ?? 1000 },
        powerups: opts.powerups ?? [],
        emotes: [],
      })),
      bots: opts.bots ?? [],
      records: opts.records ?? [],
      presenter: opts.presenter ?? null,
      finalTimes: opts.finalTimes,
    },
    {
      toGame: (event, ...args) => events.push({ to: 'game', event, payload: args[0] }),
      toUser: (userId, event, ...args) => events.push({ to: `u${userId}`, event, payload: args[0] }),
      toGameExcept: (_userId, event, ...args) => events.push({ to: 'game', event, payload: args[0] }),
    } satisfies GameEmitter,
    {
      finalize: (_game, final) => {
        standings = final;
        return new Map();
      },
      undelivered: (userId) => missed.push(userId),
      release: () => {
        released++;
      },
      // In the order things happen: the score so far is saved before the answer goes out.
      progress: () => events.push({ to: 'hooks', event: 'progress', payload: null }),
      draining: () => draining,
      crowd: () => null,
      shown: (_game, ids) => shown.push(ids),
      onClosed: () => {},
    },
  );
  game.start();
  if (!opts.countdown) advance(COUNTDOWN);
  const q = () => game.questions[game.index];
  const answerOf = () => {
    const now = q();
    if (!isChoice(now)) throw new Error('only a question with options has an option to pick');
    return now.answer;
  };
  return {
    game,
    plan,
    shown,
    events,
    missed,
    released: () => released,
    finalized: () => standings !== null,
    /** The registry's startDraining(). */
    drain: () => {
      draining = true;
      game.drain();
    },
    placement: (id: string) => standings?.find((s) => s.id === id)?.placement,
    right: (userId: number) => game.answer(`u${userId}`, game.index, answerOf()),
    wrong: (userId: number) => game.answer(`u${userId}`, game.index, (answerOf() + 1) % 4),
    guess: (userId: number, value: number) => game.guess(`u${userId}`, game.index, value),
    reveals: () => events.filter((e) => e.event === 'game:reveal').map((e) => e.payload as RevealPayload),
    of: <T>(event: string) => events.filter((e) => e.event === event).map((e) => e.payload as T),
  };
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  mock.method(Math, 'random', () => 0.5);
});
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test('leaving after being knocked out keeps that place; walking out mid-game ranks last', () => {
  // Four players, eliminations after questions 4 and 8. u1 never answers, so goes out first.
  const g = setup({ humans: [1, 2], bots: [bot('b1', 'strong'), bot('b2', 'strong')], elimination: true });
  assert.deepEqual(g.game.schedule, [4, 8]);
  for (let i = 0; i < 4; i++) {
    g.right(2);
    advance(TIME + 5_000);
  }
  assert.equal(g.game.participants.get('u1')!.eliminatedAt, 4);
  g.game.leave('u1');
  assert.notEqual(g.game.phase, 'ended', 'the match goes on');
  g.game.leave('u2'); // still in the game: a forfeit (and no humans are left, so it ends)
  assert.equal(g.game.phase, 'ended');
  assert.equal(g.placement('u1'), 3, 'knocked out 3rd-to-last stays ahead of the forfeit');
  assert.equal(g.placement('u2'), 4);
});

test('knocked out, a person answers on („Играй до края“): logged and judged, for no points and no place', () => {
  // Four players, eliminations after questions 4 and 8. u1 never answers at first, so goes out first.
  const g = setup({ humans: [1, 2], bots: [bot('b1', 'strong'), bot('b2', 'strong')], elimination: true });
  for (let i = 0; i < 4; i++) {
    g.right(2);
    advance(TIME + 5_000);
  }
  const u1 = g.game.participants.get('u1')!;
  assert.equal(u1.eliminatedAt, 4);
  advance(2_000); // the knockout's longer reveal
  assert.equal(g.game.phase, 'question');
  const [score, correct, faced] = [u1.score, u1.correct, u1.faced];
  const logged = u1.log.length;
  const index = g.game.index;
  g.right(1);
  // Only u1 hears it was taken: the race's „answered“ marks are for those still in it.
  const marks = g.events.filter(
    (e) => e.event === 'game:answered' && (e.payload as { playerId: string }).playerId === 'u1',
  );
  assert.deepEqual(
    marks.map((e) => e.to),
    ['u1'],
  );
  g.right(2);
  advance(1_000);
  const result = g.reveals().find((r) => r.index === index)!.results.u1;
  assert.deepEqual([result.correct, result.points], [true, 0]);
  assert.deepEqual([u1.score, u1.correct, u1.faced], [score, correct, faced], 'the match’s tallies stand');
  assert.equal(u1.log.length, logged + 1);
  assert.deepEqual([u1.log.at(-1)!.correct, u1.log.at(-1)!.out, u1.log.at(-1)!.points], [true, true, 0]);
  // A question let go by is no miss: nothing logged.
  advance(4_000);
  assert.equal(g.game.index, index + 1);
  g.right(2);
  advance(TIME + 1_000);
  assert.ok(g.reveals().some((r) => r.index === index + 1));
  assert.equal(u1.log.length, logged + 1);
});

test('whoever walks out first ranks last, and the last one standing wins at once', () => {
  const g = setup({ humans: [1, 2, 3] });
  g.right(1);
  g.game.leave('u1');
  g.game.leave('u2');
  assert.equal(g.game.phase, 'ended', 'nobody left to play against');
  assert.deepEqual(['u3', 'u2', 'u1'].map(g.placement), [1, 2, 3], 'leading before walking out does not help');
});

test('in a match, a dropped connection gets a few seconds before the question closes without them', () => {
  // The bot answers 2.5 s into each question.
  const g = setup({ humans: [1], bots: [bot('b1', 'strong')] });
  g.game.setConnected('u1', false);
  advance(2_000);
  assert.equal(g.game.phase, 'question', 'a refresh does not cost the question');
  g.game.setConnected('u1', true);
  g.right(1);
  advance(1_200);
  assert.equal(g.reveals()[0].results.u1.correct, true);

  advance(5_000); // next question
  g.game.setConnected('u1', false);
  advance(5_000);
  assert.equal(g.game.phase, 'question');
  advance(1_000);
  assert.equal(g.game.phase, 'reveal', "gone for good: the others don't wait out the whole clock");
});

test('a run played alone waits for its player: no early close, and it holds before the next question', () => {
  const g = setup({ humans: [1], daily: true });
  g.right(1);
  advance(1_000); // answered: revealed at once
  g.game.setConnected('u1', false);
  advance(4_500); // the reveal is over, but the next question doesn't open without them
  assert.equal(g.game.index, 0);
  assert.equal(g.game.held, true);
  advance(60_000);
  assert.equal(g.game.index, 0, 'still waiting a minute later');
  g.game.setConnected('u1', true);
  advance(2_600); // a moment to find the screen again
  assert.deepEqual([g.game.phase, g.game.index], ['question', 1]);

  // Gone mid-question: the clock keeps running (no time to look the answer up), but nothing closes early.
  g.game.setConnected('u1', false);
  advance(6_000);
  assert.equal(g.game.phase, 'question', 'not closed after the 5 s a match would give');
  advance(TIME);
  assert.equal(g.game.phase, 'reveal', 'the clock still runs out');
  assert.equal(g.reveals()[1].results.u1.choice, null);
});

test('a run alone ends with what was played after ten minutes away, or when the server stops while they are away', () => {
  const away = setup({ humans: [1], daily: true });
  away.right(1);
  away.game.setConnected('u1', false);
  advance(9 * 60_000);
  assert.notEqual(away.game.phase, 'ended');
  advance(61_000);
  assert.equal(away.game.phase, 'ended');
  assert.equal(away.finalized(), true, 'the result is saved: one correct answer');
  assert.equal(away.released(), 0);

  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 2_000_000 });
  const cut = setup({ humans: [1], daily: true });
  cut.right(1);
  cut.game.setConnected('u1', false);
  cut.drain(); // an update: nobody waits for the absent player
  advance(5_000);
  assert.equal(cut.game.phase, 'ended');
  // Given back, the same ten questions would come again after the update, some answers already known.
  assert.equal(cut.finalized(), true, 'a question was played: the result stands');
  assert.equal(cut.released(), 0);

  // Away before the first question: nothing was played, so the attempt is theirs again.
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 3_000_000 });
  const early = setup({ humans: [1], daily: true, countdown: true });
  early.game.setConnected('u1', false);
  early.drain();
  advance(5_000);
  assert.equal(early.game.phase, 'ended');
  assert.equal(early.finalized(), false);
  assert.equal(early.released(), 1, 'the attempt is theirs again');
  assert.ok(early.events.some((e) => e.to === 'u1' && e.event === 'game:aborted'));
});

test("once every person is knocked out, the bots' final is decided at once (and quietly)", () => {
  // Four players, eliminations after questions 4 and 8; u1 never answers, so goes out first.
  const g = setup({
    humans: [1],
    bots: [bot('b1', 'strong'), bot('b2', 'strong'), bot('b3', 'strong')],
    elimination: true,
  });
  advance(4 * (TIME + 5_000) - 1_000);
  assert.equal(g.game.participants.get('u1')!.eliminatedAt, 4);
  const questionsBefore = g.events.filter((e) => e.event === 'game:question').length;
  advance(6_100); // the elimination reveal
  assert.equal(g.game.phase, 'ended', 'no minutes of bots-only questions');
  assert.equal(g.game.participants.get('b1')!.faced, 10, 'the rest was played out');
  assert.equal(g.events.filter((e) => e.event === 'game:question').length, questionsBefore, 'nothing flashed by');
  assert.ok(g.placement('u1'));
});

test("an answer the server didn't take is answered with the reason", () => {
  const g = setup({ humans: [1], daily: true });
  advance(TIME + 500); // the clock ran out unanswered
  assert.equal(g.game.phase, 'reveal');
  g.game.answer('u1', 0, 2);
  const rejected = g.events.find((e) => e.to === 'u1' && e.event === 'game:rejected');
  assert.deepEqual(rejected?.payload, { index: 0, reason: 'late' });
});

test('when every human is gone, the match plays out without them instead of freezing the score', () => {
  const g = setup({ humans: [1], bots: [bot('b1', 'strong')] });
  g.right(1); // ahead after the first answer…
  g.game.setConnected('u1', false); // …then gone
  advance(31_000);
  assert.equal(g.game.phase, 'ended');
  assert.equal(g.placement('b1'), 1, 'the bot keeps scoring');
  assert.equal(g.game.participants.get('b1')!.faced, 10, 'every question was played');
  assert.deepEqual(g.missed, [1], 'the result waits for the player');
});

test('"Двойно или нищо" is for medium and hard questions, and costs 500 on a miss, never below zero', () => {
  const g = setup({ humans: [1], powerups: ['double'] });
  const difficulty = () => g.game.questions[g.game.index].difficulty;
  assert.equal(difficulty(), 'easy', 'a match opens with easy questions');
  g.game.usePowerup('u1', g.game.index, 'double');
  assert.equal(g.game.participants.get('u1')!.doubled, false, 'no bet on an easy one');
  while (difficulty() === 'easy') {
    g.right(1);
    advance(5_000);
  }
  const before = g.game.participants.get('u1')!.score;
  g.game.usePowerup('u1', g.game.index, 'double');
  g.wrong(1);
  advance(700);
  assert.equal(g.reveals().at(-1)!.results.u1.points, -500);
  assert.equal(g.game.participants.get('u1')!.score, before - 500);

  const fresh = setup({ humans: [2], powerups: ['double'] });
  while (fresh.game.questions[fresh.game.index].difficulty === 'easy') {
    fresh.wrong(2);
    advance(5_000);
  }
  fresh.game.usePowerup('u2', fresh.game.index, 'double');
  fresh.wrong(2);
  advance(700);
  assert.equal(fresh.reveals().at(-1)!.results.u2.points, 0, 'nothing to lose yet');
});

test('ties: an unanswered question counts the whole clock', () => {
  const g = setup({ humans: [1, 2] });
  advance(1_000);
  g.wrong(1); // tried, missed
  advance(TIME);
  const [reveal] = g.reveals();
  assert.equal(reveal.standings[0].id, 'u1', 'trying beats sitting it out');
});

test('a full room of bots: every one has a name of its own, none taken by a player there', () => {
  const players = ['Знайко', 'Ана'];
  const bots = makeBots(40, { level: 5, skill: 1000 }, players);
  const names = bots.map((b) => b.player.name);
  assert.ok(
    names.every((n) => typeof n === 'string' && n.length > 0),
    'more bots than names in the list',
  );
  assert.equal(new Set([...names, ...players]).size, 42);
  // Added one at a time, as a room does: still none twice.
  const room = [...players];
  for (let i = 0; i < 30; i++) room.push(makeBots(1, { level: 5, skill: 1000 }, room)[0].player.name);
  assert.equal(new Set(room).size, room.length);
});

test('bots play as strong as the rating they show, never rate above the cap, go easy on newcomers, and have favourites', () => {
  const [weak] = makeBots(1, { level: 30, skill: 900 });
  const [strong] = makeBots(1, { level: 1, skill: 2400 });
  const [gentle] = makeBots(1, { level: 1, skill: 900 }, [], { gentle: true });
  assert.equal(strong.player.rating, BOT_MAX_RATING, 'past the cap, rating has to come from beating people');
  assert.equal(weak.brain.skill, weak.player.rating, 'it plays at the rating it shows (centred on the skill)');
  assert.ok(strong.brain.skill > weak.brain.skill, 'strength follows skill, not level');
  assert.ok(strong.brain.pace < weak.brain.pace, 'stronger bots answer sooner');
  assert.ok(gentle.brain.skill < weak.brain.skill);
  assert.ok(gentle.player.rating! < weak.player.rating!, 'and it shows: everyone in the match is rated against that');
  assert.equal(new Set([...weak.brain.strong, ...weak.brain.weak]).size, 4, 'two strong categories, two weak');
  assert.deepEqual(weak.player.strong, weak.brain.strong, 'the strong ones are shown');
});

/** Plays a match to the end, the human always wrong; what the bot did comes from the events. */
function playOut(g: ReturnType<typeof setup>) {
  for (let i = 0; g.game.phase !== 'ended' && i < 100; i++) {
    if (g.game.phase === 'question') g.wrong(1);
    advance(2_000);
  }
  assert.equal(g.game.phase, 'ended');
}

/** Each joker a bot played, with the question it was played on. */
function botJokers(g: ReturnType<typeof setup>, botId: string) {
  const played: { powerup: PowerupId; question: QuestionPayload; payload: object; to: string }[] = [];
  let question: QuestionPayload | null = null;
  for (const e of g.events) {
    if (e.event === 'game:question') question = e.payload as QuestionPayload;
    const p = e.payload as { playerId?: string; powerup?: PowerupId };
    if (e.event === 'game:powerup' && p.playerId === botId)
      played.push({ powerup: p.powerup!, question: question!, payload: p, to: e.to });
  }
  return played;
}

test('bots play 50/50 when they are unsure, never on an easy question, once, and the others only see that it was played', () => {
  // Luck pinned at 0.3: a weak bot knows none of them; it reaches for 50/50, and the toss lands right.
  mock.method(Math, 'random', () => 0.3);
  const g = setup({ humans: [1], bots: [bot('b1', 'weak')] });
  playOut(g);
  const [fifty, ...more] = botJokers(g, 'b1');
  assert.equal(more.length, 0, 'once a match');
  assert.equal(fifty.powerup, 'fifty');
  assert.notEqual(fifty.question.difficulty, 'easy');
  assert.equal(fifty.to, 'game');
  assert.equal('removed' in fifty.payload, false, 'which answers went is nobody else’s business');
  const reveal = g.reveals().find((r) => r.index === fifty.question.index)!;
  assert.equal(reveal.results.b1.correct, true, 'two answers left, and the coin came down right');
});

test('a bot that doesn’t know guesses: a weak one gets a hard question right as often as a random tap', () => {
  const hard = pickQuestions(30, 'mixed', new Map()).filter((q) => q.difficulty === 'hard');
  assert.ok(hard.length >= 3);
  // Luck pinned at 0.1: 750 against 1200 is a 7% chance to be right — below a tap's 25%, so it never knows and always
  // guesses (after 50/50 on the first), landing on the first of the options left: the answer leads them. Before, a bot
  // that didn't know was always wrong.
  mock.method(Math, 'random', () => 0.1);
  const g = setup({ humans: [1], bots: [bot('b1', 'weak')], questions: hard.slice(0, 3) });
  playOut(g);
  assert.equal(g.reveals().length, 3);
  assert.ok(g.reveals().every((r) => r.results.b1.correct));
});

test('bots bet "Двойно или нищо" when they know, never on an easy question, once', () => {
  mock.method(Math, 'random', () => 0.1);
  const g = setup({ humans: [1], bots: [bot('b1', 'strong')] });
  playOut(g);
  const played = botJokers(g, 'b1');
  assert.deepEqual(
    played.map((j) => j.powerup),
    ['double'],
  );
  assert.notEqual(played[0].question.difficulty, 'easy');
  const result = g.reveals().find((r) => r.index === played[0].question.index)!.results.b1;
  assert.ok(result.correct && result.doubled && result.points >= 1000, 'the bet paid double');
});

test('the fact goes out with the reveal, never with the question (it could give the answer away)', () => {
  const g = setup({ humans: [1] });
  for (let i = 0; i < 4; i++) {
    g.right(1);
    advance(5_000);
  }
  const questions = g.events.filter((e) => e.event === 'game:question').map((e) => e.payload as QuestionPayload);
  assert.ok(questions.length > 0);
  for (const q of questions) assert.equal('fact' in q, false, `question ${q.index}`);
  for (const r of g.reveals()) assert.equal(r.fact, g.game.questions[r.index].fact ?? null);
  assert.ok(
    g.reveals().some((r) => r.fact),
    'some of these questions have one',
  );
});

test('playing alone, the player can stop on a fact: the next question waits for "Продължи", or two minutes', () => {
  const g = setup({ humans: [1] });
  const onFact = () => {
    // On to a question that has a fact, and its reveal.
    for (let i = 0; i < 20 && !g.game.questions[g.game.index].fact; i++) {
      g.right(1);
      advance(5_000);
    }
    g.right(1);
    advance(700);
    assert.equal(g.game.phase, 'reveal');
  };

  onFact();
  const index = g.game.index;
  assert.equal(g.game.hold('u1', index + 1), false, 'only the question on screen');
  assert.equal(g.game.hold('u1', index), true);
  advance(10_000);
  assert.equal(g.game.phase, 'reveal', 'well past the usual reveal, still reading');
  assert.equal(g.game.index, index);
  g.game.resume('u1');
  advance(50);
  assert.equal(g.game.phase, 'question');
  assert.equal(g.game.index, index + 1);

  onFact();
  assert.equal(g.game.hold('u1', g.game.index), true);
  const stoppedAt = g.game.index;
  advance(2 * 60_000 + 100);
  assert.equal(g.game.index, stoppedAt + 1, 'after two minutes it goes on by itself');
});

test('once the server drains, a run stopped on a fact goes on, and no new stop can hold it up', () => {
  const g = setup({ humans: [1] });
  const onFact = () => {
    for (let i = 0; i < 20 && !g.game.questions[g.game.index].fact; i++) {
      g.right(1);
      advance(5_000);
    }
    g.right(1);
    advance(700);
    assert.equal(g.game.phase, 'reveal');
  };
  onFact();
  const stoppedAt = g.game.index;
  assert.equal(g.game.hold('u1', stoppedAt), true);
  g.drain();
  advance(5_000);
  assert.equal(g.game.phase, 'question', 'the update is announced: the run goes on as if nobody had stopped');
  assert.equal(g.game.index, stoppedAt + 1);
  onFact();
  assert.equal(g.game.hold('u1', g.game.index), false, 'no more stops while the server drains');
});

test('a one-attempt run saves its score so far before each answer goes out', () => {
  const g = setup({ humans: [1], daily: true });
  g.right(1);
  advance(700);
  const order = g.events.map((e) => e.event).filter((e) => e === 'progress' || e === 'game:reveal');
  assert.deepEqual(order, ['progress', 'game:reveal']);
  const match = setup({ humans: [2, 3] });
  match.right(2);
  advance(TIME + 1_000);
  assert.ok(!match.events.some((e) => e.event === 'progress'), 'other matches save at the end only');
});

test('with other people in the match, nobody can stop it to read', () => {
  const g = setup({ humans: [1, 2] });
  for (let i = 0; i < 20 && !g.game.questions[g.game.index].fact; i++) {
    g.right(1);
    g.right(2);
    advance(5_000);
  }
  g.right(1);
  g.right(2);
  advance(700);
  assert.equal(g.game.phase, 'reveal');
  assert.equal(g.game.hold('u1', g.game.index), false);
});

test('a class’s big screen sets the pace: „Пауза“ holds the next question (ten minutes at most), „Следващ“ brings it on now', () => {
  const g = setup({ humans: [1, 2], presenter: 9 });
  const toReveal = () => {
    g.right(1);
    g.right(2);
    advance(700);
    assert.equal(g.game.phase, 'reveal');
    return g.game.index;
  };

  const at = toReveal();
  assert.equal(g.game.steer(1, at, 'pause'), false, 'only the host');
  assert.equal(g.game.steer(9, at + 1, 'pause'), false, 'only on the answer on screen');
  assert.equal(g.game.steer(9, at, 'pause'), true);
  assert.deepEqual(g.of('game:paused').at(-1), { index: at, paused: true });
  assert.equal(g.game.steer(9, at, 'pause'), false, 'paused already');
  advance(60_000);
  assert.equal(g.game.phase, 'reveal', 'a minute on, still on the answer');
  assert.equal(g.game.steer(9, at, 'next'), true);
  assert.equal(g.game.phase, 'question');
  assert.equal(g.game.index, at + 1);
  assert.equal(g.game.steer(9, at + 1, 'next'), false, 'not while the question is open');

  // „Следващ“ without a pause: on at once, and the reveal's own wait doesn't bring on another question later.
  const next = toReveal();
  assert.equal(g.game.steer(9, next, 'next'), true);
  assert.equal(g.game.index, next + 1);
  advance(4_500);
  assert.equal(g.game.index, next + 1);

  // A pause left alone runs out, and the match goes on.
  const left = toReveal();
  assert.equal(g.game.steer(9, left, 'pause'), true);
  advance(10 * 60_000 + 100);
  assert.equal(g.game.index, left + 1);
  assert.deepEqual(g.of('game:paused').at(-1), { index: left, paused: false });

  // The server drains: a pause ends, and no new one can hold the match up.
  const drained = toReveal();
  assert.equal(g.game.steer(9, drained, 'pause'), true);
  g.drain();
  advance(4_500);
  assert.equal(g.game.index, drained + 1);
  assert.equal(g.game.steer(9, toReveal(), 'pause'), false);
});

test('bots made up their minds when the question opened: once every person has answered, they answer at once', () => {
  // pace 0.3: the bot would answer three seconds in; the person answers after one.
  const g = setup({ humans: [1], bots: [bot('b1', 'strong')] });
  const first = g.game.questions[0];
  assert.ok(isChoice(first));
  advance(1_000);
  g.right(1);
  advance(600 + 50);
  const [reveal] = g.reveals();
  assert.ok(reveal, 'revealed without waiting for the bot');
  const botResult = reveal.results.b1;
  assert.equal(botResult.correct, true);
  assert.ok(botResult.timeMs! > 2_000, `the bot keeps the time it took (${botResult.timeMs} ms), and its points`);
  assert.equal(
    botResult.points,
    answerPoints({
      timeMs: botResult.timeMs!,
      limitMs: TIME,
      readMs: readingMs(first.q, first.options),
      streak: 1,
      doubled: false,
      retried: false,
    }),
  );
});

test('a bot that zoned out keeps nobody waiting once the people have answered', () => {
  const g = setup({ humans: [1], bots: [bot('b1', 'strong')] });
  g.game.participants.get('b1')!.move = null;
  g.right(1);
  advance(600 + 50);
  assert.equal(g.reveals().length, 1);
  assert.equal(g.reveals()[0].results.b1.choice, null);
});

test('the speed bonus waits out the reading window: no gain from tapping before the question is read', () => {
  const g = setup({ humans: [1, 2] });
  const first = g.game.questions[0];
  assert.ok(isChoice(first));
  const read = readingMs(first.q, first.options);
  assert.equal(g.of<QuestionPayload>('game:question')[0].readMs, read, 'the options are read too');
  assert.ok(read > readingMs(first.q) && read <= 4_500);
  advance(200);
  g.right(1);
  advance(read - 300);
  g.right(2);
  advance(600 + 50);
  const [reveal] = g.reveals();
  assert.equal(reveal.results.u1.points, reveal.results.u2.points, 'both inside the window: the same points');
  assert.equal(reveal.results.u1.points, 1000);
});

test('a daily the server has to stop once a question was shown ends with what was played, never given back', () => {
  const g = setup({ humans: [1], daily: true });
  g.right(1);
  advance(700);
  g.game.stop();
  assert.equal(g.game.phase, 'ended');
  assert.equal(g.finalized(), true, 'the answers seen so far count');
  assert.equal(g.released(), 0, 'a replay would come knowing them');

  const early = setup({ humans: [2], daily: true, countdown: true });
  early.game.stop();
  assert.equal(early.released(), 1, 'stopped in its countdown: nothing was played, the attempt is theirs again');
});

test('a daily left in its countdown was no attempt: it is the player’s again, and nothing is saved', () => {
  const g = setup({ humans: [1], daily: true, countdown: true });
  g.game.leave('u1');
  assert.equal(g.game.phase, 'ended');
  assert.equal(g.released(), 1);
  assert.equal(g.finalized(), false);
  // Once a question has been on screen, walking out uses the attempt up.
  const h = setup({ humans: [2], daily: true });
  h.game.leave('u2');
  assert.equal(h.released(), 0);
  assert.equal(h.finalized(), true);
});

// ─── Number questions ──────────────────────────────────────────────────────

const yearQuestion = () => numberBank().find((q) => q.number.scale === 'linear' && q.number.answer === 1800)!;

test('a number question: closer scores more, the exact number 250 on top, close enough is right; no speed bonus, no козове', () => {
  const year = yearQuestion();
  const g = setup({
    humans: [1, 2, 3],
    powerups: ['fifty', 'double'],
    questions: [year, ...pickQuestions(9, 'mixed', new Map())],
  });
  const [question] = g.of<QuestionPayload>('game:question');
  assert.equal(question.kind, 'number');
  assert.deepEqual(question.options, []);
  assert.deepEqual(question.number, { unit: '', min: 1000, max: 2025, step: 1, scale: 'linear' }, 'not the answer');
  assert.equal(question.durationMs, NUMBER.timeMs, 'a longer clock: it is typed in');

  g.game.usePowerup('u1', 0, 'double');
  g.game.answer('u1', 0, 0); // no options to pick
  g.guess(1, 1800);
  advance(8_000);
  g.guess(2, 1810);
  g.guess(3, 5); // below the range: brought into it
  advance(600 + 50);

  const [reveal] = g.reveals();
  assert.equal(reveal.correct, -1);
  assert.equal(reveal.answerNumber, 1800);
  const { u1, u2, u3 } = reveal.results;
  assert.deepEqual([u1.points, u1.correct, u1.number], [1250, true, { guess: 1800, closeness: 1 }], 'spot on');
  assert.deepEqual([u2.points, u2.correct, u2.streak], [800, true, 1], '10 years off of 50: 80%, and it counts');
  assert.deepEqual([u3.points, u3.correct, u3.number?.guess], [0, false, 1000]);
  assert.equal(g.game.participants.get('u1')!.usedPowerups.size, 0, 'no коз on a number');
  assert.equal(u1.doubled, false);
  const [logged] = g.game.participants.get('u2')!.log;
  assert.deepEqual([logged.choice, logged.guess, logged.closeness], [null, 1810, 0.8], 'the log keeps the number');
});

test('bots give a number too: the more they know, the closer', () => {
  const year = yearQuestion();
  const g = setup({
    humans: [1],
    bots: [bot('b1', 'strong'), bot('b2', 'weak')],
    questions: [year, ...pickQuestions(9, 'mixed', new Map())],
  });
  g.guess(1, 1800);
  advance(600 + 50);
  const { b1, b2 } = g.reveals()[0].results;
  assert.ok(b1.number!.guess! >= 1000 && b1.number!.guess! <= 2025 && Number.isInteger(b1.number!.guess));
  assert.ok(b1.number!.closeness > b2.number!.closeness);
});

test('a match ends on its final: the last question says so, and its number counts double', () => {
  const g = setup({ humans: [1], questions: [...pickQuestions(9, 'mixed', new Map()), yearQuestion()] });
  for (let i = 0; i < 9; i++) {
    g.right(1);
    advance(600 + 4_000 + 100);
  }
  const questions = g.of<QuestionPayload>('game:question');
  assert.deepEqual(
    questions.map((q) => q.final),
    [false, false, false, false, false, false, false, false, false, true],
  );
  assert.equal(questions[9].kind, 'number');
  // The final counts double: the exact number, 1250 as any other question, is worth 2500 here.
  g.guess(1, 1800);
  advance(600 + 50);
  assert.equal(questions[9].times, NUMBER.finalTimes, 'and says so');
  assert.equal(g.reveals().at(-1)!.results.u1.points, (NUMBER.points + NUMBER.exactBonus) * NUMBER.finalTimes);

  // A day's questions or a link made before the final counted double keep it single: the same rules for all who play it.
  const before = setup({
    humans: [1],
    daily: true,
    finalTimes: 1,
    questions: [...pickQuestions(9, 'mixed', new Map()), yearQuestion()],
  });
  for (let i = 0; i < 9; i++) {
    before.right(1);
    advance(600 + 4_000 + 100);
  }
  assert.equal(before.of<QuestionPayload>('game:question')[9].times, 1);
  before.guess(1, 1800);
  advance(600 + 50);
  assert.equal(before.reveals().at(-1)!.results.u1.points, NUMBER.points + NUMBER.exactBonus);
});

// ─── Rounds ────────────────────────────────────────────────────────────────

/** Plays one question of a duel: each answers right or wrong at once, then on to the reveal's end. */
function playQuestion(g: ReturnType<typeof setup>, results: Record<number, boolean>) {
  for (const [id, right] of Object.entries(results)) {
    if (g.game.questions[g.game.index].kind === 'number') g.guess(Number(id), right ? 1800 : 1000);
    else if (right) g.right(Number(id));
    else g.wrong(Number(id));
  }
  advance(600 + 4_000 + 100);
}

test('a Дуел in rounds: whoever is behind picks the next category from three, and its questions come in', () => {
  const g = setup({ humans: [1, 2], rounds: true, ratings: { 1: 1000, 2: 1100 } });
  const plan = g.plan!;
  const start = g.events.find((e) => e.event === 'game:start')!.payload as { rounds: { category: unknown }[] };
  assert.deepEqual(
    start.rounds.map((r) => r.category === null),
    [false, true, true],
    'the first round is drawn, the others picked',
  );
  for (let i = 0; i < 3; i++) playQuestion(g, { 1: true, 2: false });

  const [pick] = g.of<PickPayload>('game:pick');
  assert.equal(g.game.phase, 'pick');
  assert.equal(pick.pickerId, 'u2', 'the one behind picks');
  assert.deepEqual(
    pick.options,
    plan.rounds[1].offers.map((o) => o.category),
  );
  assert.equal(g.game.syncFor('u1').pick?.pickerId, 'u2', 'a reconnect is told too');
  g.game.pick('u1', 1, pick.options[0]);
  g.game.pick('u2', 2, pick.options[0]);
  g.game.pick('u2', 1, 'nature' === pick.options[0] ? 'music' : 'nature');
  assert.equal(g.of('game:round').length, 0, 'not theirs to pick, not this round, not on offer');

  g.game.pick('u2', 1, pick.options[2]);
  const [round] = g.of<RoundPayload>('game:round');
  assert.deepEqual([round.category, round.pickedBy], [pick.options[2], 'u2']);
  const chosen = plan.rounds[1].offers[2].questions.map((q) => q.id);
  assert.deepEqual(g.shown, [chosen], 'its questions are seen now, and only those');
  advance(2_000 + 100);
  assert.deepEqual(
    g
      .of<QuestionPayload>('game:question')
      .slice(3)
      .map((q) => q.id),
    [chosen[0]],
  );

  // Nobody picks in time: the category is drawn.
  playQuestion(g, { 1: true, 2: false });
  playQuestion(g, { 1: true, 2: false });
  playQuestion(g, { 1: true, 2: false });
  assert.equal(g.of<PickPayload>('game:pick')[1].pickerId, 'u2');
  advance(5_000 + 400 + 100);
  const drawn = g.of<RoundPayload>('game:round')[1];
  assert.equal(drawn.pickedBy, null);
  assert.ok(plan.rounds[2].offers.some((o) => o.category === drawn.category));
  advance(2_000 + 100);
  for (let i = 0; i < 3; i++) playQuestion(g, { 1: true, 2: false });

  const final = g.of<QuestionPayload>('game:question')[9];
  assert.equal(final.final, true);
  assert.equal(final.kind, 'number', 'the final is a number, from a category of its own');
  assert.ok(!g.game.rounds.some((r) => r.category === final.category));
  playQuestion(g, { 1: true, 2: true });
  assert.equal(g.game.phase, 'ended');
});

test('on a tie, the lower-rated picks', () => {
  const g = setup({ humans: [1, 2], rounds: true, ratings: { 1: 1200, 2: 1050 } });
  for (let i = 0; i < 3; i++) playQuestion(g, { 1: false, 2: false });
  assert.equal(g.of<PickPayload>('game:pick')[0].pickerId, 'u2');
});

test('a bot that is behind picks its strong category', () => {
  const plan = pickRounds(new Map())!;
  const favourite = plan.rounds[1].offers[2].category;
  const g = setup({ humans: [1], bots: [bot('b1', 'weak', { strong: [favourite] })], rounds: plan });
  for (let i = 0; i < 3; i++) playQuestion(g, { 1: true });
  assert.equal(g.of<PickPayload>('game:pick')[0].pickerId, 'b1');
  advance(2_500);
  const [round] = g.of<RoundPayload>('game:round');
  assert.deepEqual([round.category, round.pickedBy], [favourite, 'b1']);
});

test('a match in rounds nobody is left in plays its rounds out (drawn) too', () => {
  const g = setup({ humans: [1, 2], rounds: true });
  g.game.setConnected('u1', false);
  g.game.setConnected('u2', false);
  advance(31_000);
  assert.equal(g.game.phase, 'ended');
  assert.equal(g.game.played, 10);
  assert.ok(g.game.rounds.every((r) => r.category !== null));
  assert.equal(g.shown.length, 2, 'both picked rounds were drawn, and seen');
});

// ─── Recordings ────────────────────────────────────────────────────────────

test("a recording plays its owner's answers: the same pick, at the same time, with its козове", () => {
  const questions = [...pickQuestions(9, 'mixed', new Map()), yearQuestion()];
  const right = (i: number) => {
    const q = questions[i];
    assert.ok(isChoice(q));
    return q.answer;
  };
  const wrong = (i: number) => (right(i) + 1) % 4;
  const script: RecordScript = [
    { choice: right(0), timeMs: 3_000, powerup: null, retried: false },
    { choice: wrong(1), timeMs: 5_000, powerup: 'fifty', retried: false },
    null,
    ...Array.from({ length: 6 }, (_, k) => ({ choice: right(k + 3), timeMs: 2_000, powerup: null, retried: false })),
    { value: 1810, timeMs: 9_000, powerup: null, retried: false },
  ];
  const record = { ...player('r7', null), name: 'Иван', record: { playedAt: 1 } };
  const g = setup({ humans: [1], questions, records: [{ player: record, script, runId: 7, ownerId: 99 }] });

  // It answers when its owner did, without waiting for anyone.
  advance(3_000 + 50);
  assert.ok(g.game.participants.get('r7')!.answer, 'answered at 3 s');
  g.right(1);
  advance(600 + 50);
  const [first] = g.reveals();
  assert.deepEqual(
    [first.results.r7.choice, first.results.r7.timeMs, first.results.r7.correct],
    [right(0), 3_000, true],
  );

  // Once the person has answered, the recording answers at once, with its own time, and its коз first: a 50/50 that
  // leaves the option it went on to pick.
  advance(4_000);
  g.right(1);
  advance(600 + 50);
  const second = g.reveals()[1].results.r7;
  assert.deepEqual([second.choice, second.timeMs, second.correct], [wrong(1), 5_000, false]);
  assert.ok(!g.game.participants.get('r7')!.removed.includes(wrong(1)));
  assert.ok(
    g
      .of<{ playerId: string; powerup: string }>('game:powerup')
      .some((e) => e.playerId === 'r7' && e.powerup === 'fifty'),
  );

  // No answer recorded: none given (the clock runs out for it).
  advance(4_000);
  g.right(1);
  advance(600 + 50);
  assert.equal(g.reveals()[2].results.r7.choice, null);

  // On to the final: its number.
  for (let i = 3; i < 9; i++) {
    advance(4_000);
    g.right(1);
    advance(600 + 50);
  }
  advance(4_000);
  g.guess(1, 1800);
  advance(600 + 50);
  assert.deepEqual(g.reveals()[9].results.r7.number, { guess: 1810, closeness: 0.8 });
  assert.equal(g.game.participants.get('r7')!.log.length, 0, "nothing of it is logged as a person's answers");
  advance(4_000 + 100);
  assert.equal(g.game.phase, 'ended');
});
