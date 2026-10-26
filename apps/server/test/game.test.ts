// The match engine on its own, on a mocked clock: leaving, dropped connections, abandoned matches and scoring rules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { FinalStanding, GamePlayer, PowerupId, QuestionPayload, RevealPayload } from '@quiz/shared';
import type { GameEmitter } from '../src/game/Game';
import { writeFixtureQuestions } from './helpers';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-game-'));
process.env.DB_PATH = path.join(tmp, 'game.db');
process.env.QUESTIONS_PATH = path.join(tmp, 'questions.json');
writeFixtureQuestions(process.env.QUESTIONS_PATH);
const { Game } = await import('../src/game/Game');
const { pickQuestions } = await import('../src/questions');
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

/** Bots that always answer right ('strong') or always wrong ('weak') once Math.random is pinned to 0.5. */
const bot = (id: string, kind: 'strong' | 'weak') => ({
  player: player(id, null),
  brain: { accuracy: kind === 'strong' ? 0.92 : 0.2, pace: 0.3 },
});

function setup(opts: {
  humans: number[];
  bots?: ReturnType<typeof bot>[];
  elimination?: boolean;
  powerups?: PowerupId[];
  /** A daily run (one attempt). */
  daily?: boolean;
}) {
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
      questions: pickQuestions(10, 'mixed', new Map()),
      humans: opts.humans.map((id) => ({ player: player(`u${id}`, id), powerups: opts.powerups ?? [], emotes: [] })),
      bots: opts.bots ?? [],
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
      draining: () => draining,
      onClosed: () => {},
    },
  );
  game.start();
  advance(COUNTDOWN);
  const q = () => game.questions[game.index];
  return {
    game,
    events,
    missed,
    released: () => released,
    finalized: () => standings !== null,
    drain: () => {
      draining = true;
    },
    placement: (id: string) => standings?.find((s) => s.id === id)?.placement,
    right: (userId: number) => game.answer(`u${userId}`, game.index, q().answer),
    wrong: (userId: number) => game.answer(`u${userId}`, game.index, (q().answer + 1) % 4),
    reveals: () => events.filter((e) => e.event === 'game:reveal').map((e) => e.payload as RevealPayload),
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
  // Four players, eliminations after questions 3 and 8. u1 never answers, so goes out first.
  const g = setup({ humans: [1, 2], bots: [bot('b1', 'strong'), bot('b2', 'strong')], elimination: true });
  for (let i = 0; i < 3; i++) {
    g.right(2);
    advance(TIME + 5_000);
  }
  assert.equal(g.game.participants.get('u1')!.eliminatedAt, 3);
  g.game.leave('u1');
  assert.notEqual(g.game.phase, 'ended', 'the match goes on');
  g.game.leave('u2'); // still in the game: a forfeit (and no humans are left, so it ends)
  assert.equal(g.game.phase, 'ended');
  assert.equal(g.placement('u1'), 3, 'knocked out 3rd-to-last stays ahead of the forfeit');
  assert.equal(g.placement('u2'), 4);
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

test('a run alone ends with what was played after ten minutes away; when the server stops it keeps the attempt', () => {
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
  assert.equal(cut.finalized(), false, 'no result for a run we cut');
  assert.equal(cut.released(), 1, 'the attempt is theirs again');
  assert.ok(cut.events.some((e) => e.to === 'u1' && e.event === 'game:aborted'));
});

test("once every person is knocked out, the bots' final is decided at once (and quietly)", () => {
  // Four players, eliminations after questions 3 and 8; u1 never answers, so goes out first.
  const g = setup({
    humans: [1],
    bots: [bot('b1', 'strong'), bot('b2', 'strong'), bot('b3', 'strong')],
    elimination: true,
  });
  advance(3 * (TIME + 5_000));
  assert.equal(g.game.participants.get('u1')!.eliminatedAt, 3);
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

test('bots play as strong as the rating they show, never rate above the cap, and go easy on newcomers', () => {
  const [weak] = makeBots(1, { level: 30, rating: 900 });
  const [strong] = makeBots(1, { level: 1, rating: 2400 });
  const [gentle] = makeBots(1, { level: 1, rating: 900 }, [], { gentle: true });
  assert.equal(strong.player.rating, BOT_MAX_RATING, 'past the cap, rating has to come from beating people');
  assert.ok(strong.brain.accuracy > weak.brain.accuracy, 'strength follows rating, not level');
  assert.ok(strong.brain.pace < weak.brain.pace, 'stronger bots answer sooner');
  assert.ok(gentle.brain.accuracy < weak.brain.accuracy);
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
  // Luck pinned at 0.3: a weak bot knows the easy ones, not the rest; it reaches for 50/50, and the toss lands right.
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
