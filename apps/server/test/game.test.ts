// The match engine on its own, on a mocked clock: leaving, dropped connections, abandoned matches and scoring rules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { FinalStanding, GamePlayer, PowerupId, RevealPayload } from '@quiz/shared';
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

function setup(opts: { humans: number[]; bots?: ReturnType<typeof bot>[]; elimination?: boolean; powerups?: PowerupId[] }) {
  const events: { to: string; event: string; payload: any }[] = [];
  let standings: FinalStanding[] | null = null;
  const missed: number[] = [];
  const game = new Game(
    {
      mode: 'custom',
      ranked: false,
      roomCode: null,
      hostUserId: null,
      timeMs: TIME,
      category: 'mixed',
      elimination: opts.elimination ?? false,
      teams: false,
      dailyDay: null,
      challengeId: null,
      questions: pickQuestions(10, 'mixed', new Map()),
      humans: opts.humans.map((id) => ({ player: player(`u${id}`, id), powerups: opts.powerups ?? [], emotes: [] })),
      bots: opts.bots ?? [],
    },
    {
      toGame: (event: string, payload: unknown) => events.push({ to: 'game', event, payload }),
      toUser: (userId: number, event: string, payload: unknown) => events.push({ to: `u${userId}`, event, payload }),
      toGameExcept: (_userId: number, event: string, payload: unknown) => events.push({ to: 'game', event, payload }),
    } as never,
    {
      finalize: (_game, final) => {
        standings = final;
        return new Map();
      },
      undelivered: (userId) => missed.push(userId),
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

test('a dropped connection gets a few seconds before the question closes without them', () => {
  const g = setup({ humans: [1] });
  g.game.setConnected('u1', false);
  advance(2_000);
  assert.equal(g.game.phase, 'question', 'a refresh does not cost the question');
  g.game.setConnected('u1', true);
  g.right(1);
  advance(700);
  assert.equal(g.reveals()[0].results.u1.correct, true);

  advance(5_000); // next question
  g.game.setConnected('u1', false);
  advance(5_000);
  assert.equal(g.game.phase, 'question');
  advance(1_000);
  assert.equal(g.game.phase, 'reveal', 'gone for good: no waiting out the whole clock');
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

test('"Двойно или нищо" costs 500 on a miss, never below zero', () => {
  const g = setup({ humans: [1], powerups: ['double'] });
  g.right(1);
  advance(5_000);
  const before = g.game.participants.get('u1')!.score;
  g.game.usePowerup('u1', g.game.index, 'double');
  g.wrong(1);
  advance(700);
  assert.equal(g.reveals()[1].results.u1.points, -500);
  assert.equal(g.game.participants.get('u1')!.score, before - 500);

  const fresh = setup({ humans: [2], powerups: ['double'] });
  fresh.game.usePowerup('u2', fresh.game.index, 'double');
  fresh.wrong(2);
  advance(700);
  assert.equal(fresh.reveals()[0].results.u2.points, 0, 'nothing to lose yet');
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
