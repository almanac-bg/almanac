// What a ranked match pays, on a real database and a mocked clock: a walkout before the match gets going is no contest,
// a later one is a win paid for the part played, guests play people unrated, the win-trading guard says why a rating
// stayed put, and a guest never draws a quest only an account can finish.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { type GameEndPayload, type GamePlayer, RATED_GAMES_PER_PAIR, shiftDay } from '@quiz/shared';
import type { GameEmitter } from '../src/game/Game';
import { writeFixtureQuestions } from './helpers';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-rewards-'));
process.env.DB_PATH = path.join(tmp, 'rewards.db');
process.env.QUESTIONS_PATH = path.join(tmp, 'questions.json');
process.env.BACKUP_DIR = 'off';
writeFixtureQuestions(process.env.QUESTIONS_PATH);
const { Game } = await import('../src/game/Game');
const { finalizeMatch } = await import('../src/game/rewards');
const { pickQuestions } = await import('../src/questions');
const { createGuest } = await import('../src/guests');
const { questsInfo } = await import('../src/quests');
const { one, run } = await import('../src/db');
const { getUser, usernameKey } = await import('../src/users');

const COUNTDOWN = 3_500;
const TIME = 10_000;
/** Both answered: a short pause, the reveal, then the next question. */
const NEXT_QUESTION = 600 + 4_000 + 50;
const advance = (ms: number) => {
  for (let t = 0; t < ms; t += 50) mock.timers.tick(Math.min(50, ms - t));
};

let accounts = 0;
function account(): number {
  const name = `player${++accounts}`;
  const { lastInsertRowid } = run(
    "INSERT INTO users (username, username_key, password_hash, created_at) VALUES (?, ?, '', ?)",
    name,
    usernameKey(name),
    Date.now(),
  );
  return Number(lastInsertRowid);
}

const player = (userId: number): GamePlayer => ({
  id: `u${userId}`,
  userId,
  name: `u${userId}`,
  level: 1,
  isBot: false,
  rating: 1000,
  avatar: 'fox',
  frame: 'classic',
  title: 'rookie',
  team: null,
});

/**
 * A ranked duel: `winner` answers right, the other wrong, and the other walks out after `leaveAfter` questions
 * (0: during the countdown; null: never).
 */
function duel(winner: number, other: number, leaveAfter: number | null) {
  const ends = new Map<number, GameEndPayload>();
  const game = new Game(
    {
      mode: 'duel',
      ranked: true,
      roomCode: null,
      hostUserId: null,
      timeMs: TIME,
      category: 'mixed',
      elimination: false,
      teams: false,
      dailyDay: null,
      challengeId: null,
      questions: pickQuestions(10, 'mixed', new Map()),
      humans: [winner, other].map((id) => ({ player: player(id), powerups: [], emotes: [] })),
      bots: [],
    },
    {
      toGame: () => {},
      toUser: (userId, event, ...args) => {
        if (event === 'game:end') ends.set(userId, args[0] as GameEndPayload);
      },
      toGameExcept: () => {},
    } satisfies GameEmitter,
    { finalize: finalizeMatch, undelivered: () => {}, onClosed: () => {} },
  );
  game.start();
  if (leaveAfter === 0) game.leave(`u${other}`);
  else advance(COUNTDOWN);
  for (let i = 0; game.phase !== 'ended'; i++) {
    if (i === leaveAfter) {
      game.leave(`u${other}`);
      break;
    }
    const q = game.questions[game.index];
    game.answer(`u${winner}`, game.index, q.answer);
    game.answer(`u${other}`, game.index, (q.answer + 1) % 4);
    advance(NEXT_QUESTION);
  }
  assert.equal(game.phase, 'ended');
  const deltaOf = (userId: number) =>
    one<{ d: number | null }>(
      'SELECT rating_delta AS d FROM match_players WHERE match_id = ? AND user_id = ?',
      game.id,
      userId,
    )!.d;
  return { end: ends.get(winner)!, deltaOf };
}

const labels = (end: GameEndPayload) => end.rewards!.breakdown.map((l) => l.label);

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  mock.method(Math, 'random', () => 0.5);
});
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test('walking out before the third question is no contest: no win, no rating, no match played', () => {
  for (const leaveAfter of [0, 2]) {
    const [a, b] = [account(), account()];
    const { end, deltaOf } = duel(a, b, leaveAfter);
    assert.equal(end.noContest, true);
    assert.ok(!labels(end).includes('Победа') && !labels(end).includes('Изигран мач'), labels(end).join(', '));
    assert.equal(end.rewards!.rating, null);
    assert.equal(end.rewards!.unrated, 'no_contest');
    assert.equal(deltaOf(a), null);
    assert.ok(deltaOf(b)! < 0, 'the one who walked out still loses rating');
    const user = getUser(a)!;
    assert.deepEqual([user.wins, user.games_played, user.mp_games], [0, 0, 0]);
  }
});

test('a walkout later in the match is a win, paid for the part that was played', () => {
  const [a, b] = [account(), account()];
  const { end } = duel(a, b, 4);
  assert.equal(end.noContest, false);
  const win = end.rewards!.breakdown.find((l) => l.label === 'Победа');
  assert.equal(win?.amount, Math.round((50 + 15) * 0.4), '4 of 10 questions');
  assert.ok(end.rewards!.rating!.after > end.rewards!.rating!.before);
  assert.ok(!end.rewards!.achievements.includes('photo_finish'), 'no photo finish against an empty chair');
  assert.equal(getUser(a)!.wins, 1);
});

test('guests play people unrated, and both sides are told why', () => {
  const a = account();
  const g = createGuest();
  const won = duel(a, g, null);
  assert.equal(won.end.rewards!.rating, null);
  assert.equal(won.end.rewards!.unrated, 'guest');
  assert.ok(labels(won.end).includes('Победа'), 'XP as usual');
  assert.equal(won.deltaOf(g), null);
  const lost = duel(g, a, null);
  assert.equal(lost.end.rewards!.unrated, 'guest');
});

test(`the same two people move each other's rating ${RATED_GAMES_PER_PAIR} times a day, then the match says why`, () => {
  const [a, b] = [account(), account()];
  for (let i = 0; i < RATED_GAMES_PER_PAIR; i++) {
    assert.notEqual(duel(a, b, 3).end.rewards!.rating, null, `game ${i + 1} is rated`);
  }
  const capped = duel(a, b, 3).end.rewards!;
  assert.equal(capped.rating, null);
  assert.equal(capped.unrated, 'pair');
});

test('a guest never draws a quest only an account can finish', () => {
  const g = createGuest();
  const a = account();
  const days = Array.from({ length: 60 }, (_, i) => shiftDay('2026-11-01', i));
  const quests = (userId: number) => days.flatMap((day) => questsInfo(userId, day).quests.map((q) => q.id));
  assert.ok(!quests(g).includes('challenge'));
  assert.ok(quests(a).includes('challenge'), 'accounts do get it');
});
