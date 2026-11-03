// A finished match as its results say it, the same on the web and in the app: the headline, won or lost (and how
// loudly), what comes next — and the steps of the reward moment, the top of a big match.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEVEL_CHOICES } from '@almanac/shared';
import { type LiveGame, matchOutcome, rewardSteps, topAndYou } from '../src/index.ts';

type Row = { id: string; score?: number; correct?: number; placement: number; left?: boolean };
const game = (
  mode: string,
  rows: Row[],
  more: { rewards?: object; teamScores?: object; noContest?: boolean; players?: number } = {},
) =>
  ({
    start: {
      youId: 'u1',
      totalQuestions: 10,
      players: Array.from({ length: more.players ?? rows.length }, () => ({})),
    },
    end: {
      mode,
      roomCode: null,
      noContest: more.noContest ?? false,
      teamScores: more.teamScores ?? null,
      rewards: more.rewards ?? null,
      standings: rows.map((r) => ({ score: 0, correct: 5, left: false, eliminatedAt: null, ...r })),
    },
  }) as unknown as LiveGame;
const say = (g: LiveGame, reviewDue = 0) => matchOutcome(g, { roomGuest: false, reviewDue });

test('alone: perfect or done, a record beaten, quiet under half right', () => {
  assert.equal(say(game('solo', [{ id: 'u1', correct: 10, placement: 1 }])).headline, 'Перфектно!');
  const half = say(game('solo', [{ id: 'u1', correct: 4, score: 900, placement: 1 }], { rewards: { soloBest: 800 } }));
  assert.equal(half.headline, 'Готово!');
  assert.ok(half.quiet && half.newBest && half.fanfare);
  assert.equal(say(game('daily', [{ id: 'u1', correct: 10, placement: 1 }])).headline, 'Перфектен ден!');
});

test('against others: a win, a loss of two, a place of more, a walkout, no contest', () => {
  const two = (placement: number) =>
    game('duel', [
      { id: 'u1', placement },
      { id: 'u2', placement: 3 - placement },
    ]);
  assert.equal(say(two(1)).headline, 'Победа!');
  const lost = say(two(2));
  assert.ok(lost.headline === 'Загуба' && lost.lost && lost.quiet);
  const royale = say(
    game('royale', [
      { id: 'u2', placement: 1 },
      { id: 'u1', placement: 2 },
      { id: 'u3', placement: 3 },
    ]),
  );
  assert.equal(royale.headline, '2-ро място');
  const walkout = say(
    game('duel', [
      { id: 'u1', placement: 1 },
      { id: 'u2', placement: 2, left: true },
    ]),
  );
  assert.ok(walkout.won && walkout.byWalkout);
  assert.equal(
    say(
      game(
        'duel',
        [
          { id: 'u1', placement: 1 },
          { id: 'u2', placement: 2 },
        ],
        { noContest: true },
      ),
    ).headline,
    'Съперникът напусна',
  );
});

test('a link and a friend duel: the bar set, a place on the board, a duel lost', () => {
  const link = (challenge: object) =>
    say(game('challenge', [{ id: 'u1', score: 1200, placement: 1 }], { rewards: { challenge } }));
  assert.equal(link({ rank: 1, total: 1, duel: null }).headline, 'Летвата е поставена!');
  assert.ok(link({ rank: 1, total: 4, duel: null }).won);
  assert.equal(link({ rank: 3, total: 4, duel: null }).headline, '3-то място');
  const duel = link({ rank: 2, total: 2, duel: { outcome: 'lost' } });
  assert.ok(duel.headline === 'Загуба' && duel.lost);
  assert.equal(link({ rank: 1, total: 1, duel: { outcome: null } }).headline, 'Ходът ти е изигран');
});

test('what comes next: another review while there are missed ones, home after Отбори and the evening', () => {
  const review = game('review', [{ id: 'u1', placement: 1 }]);
  assert.ok(say(review, 6).moreReview);
  assert.ok(!say(review, 1).moreReview);
  assert.ok(
    say(
      game(
        'teams',
        [
          { id: 'u1', placement: 1 },
          { id: 'u2', placement: 2 },
        ],
        { teamScores: [{ team: 0, score: 1 }] },
      ),
    ).againIsHome,
  );
  assert.ok(
    say(
      game('evening', [
        { id: 'u1', placement: 1 },
        { id: 'u2', placement: 2 },
      ]),
    ).againIsHome,
  );
  assert.ok(
    !say(
      game('duel', [
        { id: 'u1', placement: 1 },
        { id: 'u2', placement: 2 },
      ]),
    ).againIsHome,
  );
});

test('the reward moment: the level, a milestone to pick, the avatars and frames (three at most)', () => {
  const milestone = LEVEL_CHOICES[0]!.level;
  const unlock = (id: string) => ({ kind: 'avatar' as const, id });
  const steps = rewardSteps({
    levelBefore: milestone - 1,
    levelAfter: milestone,
    unlocks: [unlock('a'), unlock('b'), { kind: 'title', id: 't' }, unlock('c'), unlock('d')],
  } as never);
  assert.deepEqual(
    steps.map((s) => s.kind),
    ['level', 'choice', 'unlock', 'unlock', 'unlock'],
  );
  const last = steps.at(-1);
  assert.equal(last?.kind === 'unlock' ? last.more : null, 1);
  assert.deepEqual(rewardSteps(null), []);
});

test('a big match shows the top and you', () => {
  const list = Array.from({ length: 20 }, (_, i) => ({ id: `u${i + 1}` }));
  assert.deepEqual(topAndYou(list, 'u3', 7).gap, null);
  const far = topAndYou(list, 'u15', 7);
  assert.deepEqual(far.shown.map((x) => x.id).at(-1), 'u15');
  assert.equal(far.gap, 7);
});
