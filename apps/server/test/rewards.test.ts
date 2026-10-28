// What a ranked match pays, on a real database and a mocked clock: a walkout before the match gets going is no contest,
// a later one is a win paid for the part played, guests and new accounts play people unrated, the win-trading guard
// says why a rating stayed put, a private room pays only for beating people who played (and only so much a day), and a
// guest never draws a quest only an account can finish.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, mock, test } from 'node:test';
import {
  type GameEndPayload,
  type GamePlayer,
  POWERUPS,
  RATED_AFTER,
  RATED_GAMES_PER_PAIR,
  shiftDay,
  xpToReach,
} from '@quiz/shared';
import type { GameEmitter } from '../src/game/Game';
import { writeFixtureQuestions } from './helpers';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-rewards-'));
process.env.DB_PATH = path.join(tmp, 'rewards.db');
process.env.QUESTIONS_PATH = path.join(tmp, 'questions.json');
process.env.BACKUP_DIR = 'off';
writeFixtureQuestions(process.env.QUESTIONS_PATH);
const { Game, gameClock } = await import('../src/game/Game');
// The match's clock follows the mocked Date (mock.timers can't mock performance.now).
gameClock.now = () => Date.now();
const { botK, finalizeMatch, PROVISIONAL, ROOM_PLACEMENT_XP_PER_DAY } = await import('../src/game/rewards');
const { playCheck, SUSPICIOUS } = await import('../src/answers');
const { recordRating } = await import('../src/seasons');
const getRatingOf = (userId: number) =>
  one<{ rating: number }>("SELECT rating FROM season_ratings WHERE user_id = ? AND mode = 'duel'", userId)?.rating ??
  null;
const { buildHuman } = await import('../src/game/registry');
const { pickQuestions } = await import('../src/questions');
const { createGuest } = await import('../src/guests');
const { questsInfo } = await import('../src/quests');
const { dailyQuestions, redrawDailyWithout } = await import('../src/daily');
const { reloadQuestionBank } = await import('../src/questions');
const { all, one, run } = await import('../src/db');
const { getUser, usernameKey } = await import('../src/users');

const COUNTDOWN = 3_500;
const TIME = 10_000;
/** Both answered: a short pause, the reveal, then the next question. */
const NEXT_QUESTION = 600 + 4_000 + 50;
const advance = (ms: number) => {
  for (let t = 0; t < ms; t += 50) mock.timers.tick(Math.min(50, ms - t));
};

let accounts = 0;
/** An account that has been around (a day old, RATED_AFTER.games played), or a `fresh` one made just now. */
function account({ fresh = false } = {}): number {
  const name = `player${++accounts}`;
  const { lastInsertRowid } = run(
    "INSERT INTO users (username, username_key, password_hash, created_at, games_played) VALUES (?, ?, '', ?, ?)",
    name,
    usernameKey(name),
    Date.now() - (fresh ? 0 : RATED_AFTER.ms),
    fresh ? 0 : RATED_AFTER.games,
  );
  return Number(lastInsertRowid);
}

const player = (userId: number): GamePlayer => ({
  id: `u${userId}`,
  userId,
  name: `u${userId}`,
  level: 1,
  isBot: false,
  isGuest: false,
  rating: 1000,
  avatar: 'fox',
  frame: 'classic',
  title: 'rookie',
  team: null,
});

/** The open question, which in these matches always has options. */
function choiceAt(game: InstanceType<typeof Game>) {
  const q = game.questions[game.index];
  assert.ok(q.kind !== 'number');
  return q;
}

/**
 * A ranked duel: `winner` answers right, the other wrong, and the other walks out after `leaveAfter` questions
 * (0: during the countdown; null: never). `cutAfter`: the server stops the match after that many questions.
 */
function duel(winner: number, other: number, leaveAfter: number | null, cutAfter: number | null = null) {
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
      rounds: [],
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
    {
      finalize: finalizeMatch,
      undelivered: () => {},
      release: () => {},
      progress: () => {},
      draining: () => false,
      shown: () => {},
      onClosed: () => {},
    },
  );
  game.start();
  if (leaveAfter === 0) game.leave(`u${other}`);
  else advance(COUNTDOWN);
  for (let i = 0; game.phase !== 'ended'; i++) {
    if (i === leaveAfter) {
      game.leave(`u${other}`);
      break;
    }
    if (i === cutAfter) {
      game.stop();
      break;
    }
    const q = choiceAt(game);
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

/**
 * A private room for two people: the host answers everything right; the other answers wrong, or never (`idle`: a
 * second window left open).
 */
function room(host: number, other: number, { questions = 10, idle = false } = {}) {
  const ends = new Map<number, GameEndPayload>();
  const game = new Game(
    {
      mode: 'custom',
      ranked: false,
      roomCode: '123456',
      hostUserId: host,
      timeMs: TIME,
      category: 'mixed',
      elimination: false,
      teams: false,
      dailyDay: null,
      challengeId: null,
      questions: pickQuestions(questions, 'mixed', new Map()),
      rounds: [],
      humans: [host, other].map((id) => ({ player: player(id), powerups: [], emotes: [] })),
      bots: [],
    },
    {
      toGame: () => {},
      toUser: (userId, event, ...args) => {
        if (event === 'game:end') ends.set(userId, args[0] as GameEndPayload);
      },
      toGameExcept: () => {},
    } satisfies GameEmitter,
    {
      finalize: finalizeMatch,
      undelivered: () => {},
      release: () => {},
      progress: () => {},
      draining: () => false,
      shown: () => {},
      onClosed: () => {},
    },
  );
  game.start();
  advance(COUNTDOWN);
  while (game.phase !== 'ended') {
    const q = choiceAt(game);
    game.answer(`u${host}`, game.index, q.answer);
    if (!idle) game.answer(`u${other}`, game.index, (q.answer + 1) % 4);
    advance(idle ? TIME + 4_000 + 500 : NEXT_QUESTION);
  }
  return ends.get(host)!;
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
    assert.deepEqual([user.wins, user.games_played - RATED_AFTER.games, user.mp_games], [0, 0, 0]);
  }
});

test('a walkout later in the match is a win, paid for the part that was played', () => {
  const [a, b] = [account(), account()];
  const { end } = duel(a, b, 4);
  assert.equal(end.noContest, false);
  const win = end.rewards!.breakdown.find((l) => l.label === 'Победа');
  assert.equal(win?.amount, Math.round((50 + 15) * 0.4), '4 of 10 questions');
  // A full win between two at 1000 is +20 (K 40), doubled in a first rated game (PROVISIONAL); four questions of ten
  // pay 40% of it.
  assert.equal(end.rewards!.rating!.after - end.rewards!.rating!.before, 16, 'rating for the part played, too');
  assert.ok(!end.rewards!.achievements.includes('photo_finish'), 'no photo finish against an empty chair');
  assert.equal(getUser(a)!.wins, 1);
});

test('a match we cut short (an update that could not wait) pays for what was played, unrated and with no winner', () => {
  const [a, b] = [account(), account()];
  const { end, deltaOf } = duel(a, b, null, 5);
  assert.equal(end.noContest, false);
  assert.equal(end.rewards!.rating, null);
  assert.equal(end.rewards!.unrated, 'cut');
  assert.deepEqual([deltaOf(a), deltaOf(b)], [null, null]);
  assert.ok(!labels(end).includes('Победа'), labels(end).join(', '));
  assert.ok(
    labels(end).some((l) => l.startsWith('Верни отговори')),
    'the answers still count',
  );
  assert.equal(getUser(a)!.wins, 0);
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

test('a walkout during the countdown is no game between the two for that limit, whoever walked out', () => {
  // The leaver has the lower account number: their row is the one with a rating change.
  const [low, high] = [account(), account()];
  duel(high, low, 0);
  for (let i = 0; i < RATED_GAMES_PER_PAIR; i++) {
    assert.notEqual(duel(high, low, 3).end.rewards!.rating, null, `game ${i + 1} is rated`);
  }
  assert.equal(duel(high, low, 3).end.rewards!.unrated, 'pair');
});

test('a guest never draws a quest only an account can finish', () => {
  const g = createGuest();
  const a = account();
  const days = Array.from({ length: 60 }, (_, i) => shiftDay('2026-11-01', i));
  const quests = (userId: number) => days.flatMap((day) => questsInfo(userId, day).quests.map((q) => q.id));
  assert.ok(!quests(g).includes('challenge'));
  assert.ok(quests(a).includes('challenge'), 'accounts do get it');
});

test('a newcomer draws quests a first day can finish; the harder ones come from level 3', () => {
  const days = Array.from({ length: 60 }, (_, i) => shiftDay('2026-12-01', i));
  const drawn = (userId: number) => new Set(days.flatMap((day) => questsInfo(userId, day).quests.map((q) => q.id)));
  const newcomer = drawn(account());
  for (const id of ['correct25', 'hard4', 'streak6', 'win2']) assert.ok(!newcomer.has(id), id);
  assert.ok(![...newcomer].some((id) => id.startsWith('cat:')), 'no category quests yet');
  assert.ok(newcomer.has('correct15') && newcomer.has('joker1'), 'the starter ones instead');

  const seasonedId = account();
  run('UPDATE users SET xp = ? WHERE id = ?', xpToReach(3), seasonedId);
  const seasoned = drawn(seasonedId);
  for (const id of ['correct25', 'hard4', 'streak6', 'win2']) assert.ok(seasoned.has(id), id);
  assert.ok(!seasoned.has('correct15') && !seasoned.has('joker1'), 'and the starter ones are behind them');
});

test('a rating finds its level sooner: the first ten rated games in a mode move it twice as far', () => {
  const [a, b] = [account(), account()];
  for (let i = 0; i < PROVISIONAL.games; i++) recordRating(a, 'duel', 1000, false);
  const { deltaOf } = duel(a, b, null);
  assert.equal(Math.round(deltaOf(a)!), 20, 'ten games in: the usual step');
  assert.equal(Math.round(deltaOf(b)!), -40, 'a first game: twice');
});

test("a recording moves the player's rating as a bot does, not its owner's, and its owner hears how it did", () => {
  const me = account();
  const owner = account();
  const runId = Number(
    run(
      `INSERT INTO runs (match_id, user_id, mode, category, rating, score, correct, answers, played_at)
       VALUES ('old', ?, 'duel', 'mixed', 1000, 0, 0, '[]', ?)`,
      owner,
      Date.now(),
    ).lastInsertRowid,
  );
  for (let i = 0; i < PROVISIONAL.games; i++) recordRating(me, 'duel', 1000, false);
  const ends: GameEndPayload[] = [];
  const recording = { ...player(owner), id: `r${runId}`, userId: null, record: { playedAt: 0 } };
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
      questions: pickQuestions(5, 'mixed', new Map()),
      rounds: [],
      humans: [{ player: player(me), powerups: [], emotes: [] }],
      bots: [],
      // It answered nothing in time.
      records: [{ player: recording, script: [null, null, null, null, null], runId, ownerId: owner }],
    },
    {
      toGame: () => {},
      toUser: (_userId, event, ...args) => {
        if (event === 'game:end') ends.push(args[0] as GameEndPayload);
      },
      toGameExcept: () => {},
    } satisfies GameEmitter,
    {
      finalize: finalizeMatch,
      undelivered: () => {},
      release: () => {},
      progress: () => {},
      draining: () => false,
      shown: () => {},
      onClosed: () => {},
    },
  );
  game.start();
  advance(COUNTDOWN);
  while (game.phase !== 'ended') {
    game.answer(`u${me}`, game.index, choiceAt(game).answer);
    advance(NEXT_QUESTION + TIME);
  }
  const [end] = ends;
  assert.equal(end.rewards!.rating!.after - end.rewards!.rating!.before, Math.round(botK(1000) / 2), 'the bots’ step');
  assert.equal(getRatingOf(owner), null, 'its owner played nothing now');
  assert.deepEqual(
    {
      ...one<{ owner_id: number; player_id: number; record_won: number }>(
        'SELECT owner_id, player_id, record_won FROM record_plays',
      ),
    },
    { owner_id: owner, player_id: me, record_won: 0 },
  );
});

test('games against bots move a rating less and less above 1450, and not at all from the bots’ ceiling up', () => {
  assert.equal(botK(800), 24);
  assert.equal(botK(1450), 24);
  assert.equal(botK(1525), 12);
  assert.equal(botK(1600), 0);
  assert.equal(botK(1900), 0, 'no climbing (or sliding) on bots at the top');
});

test('everyone has all the козове from the first match, except in the runs everyone compares', () => {
  const newcomer = account();
  const all = POWERUPS.map((p) => p.id);
  assert.deepEqual(buildHuman(newcomer, 'duel').powerups, all, 'ranked');
  assert.deepEqual(buildHuman(newcomer, 'solo').powerups, all, 'alone');
  assert.deepEqual(buildHuman(newcomer, 'custom').powerups, all, 'a private room');
  assert.deepEqual(buildHuman(newcomer, 'daily').powerups, [], 'not the daily');
  assert.deepEqual(buildHuman(newcomer, 'challenge').powerups, [], 'nor a challenge link');
});

test('a private room with nobody else in it is practice: winning there is no win', () => {
  const host = account();
  const ends: GameEndPayload[] = [];
  const game = new Game(
    {
      mode: 'custom',
      ranked: false,
      roomCode: '12345',
      hostUserId: host,
      timeMs: TIME,
      category: 'mixed',
      elimination: false,
      teams: false,
      dailyDay: null,
      challengeId: null,
      questions: pickQuestions(5, 'mixed', new Map()),
      rounds: [],
      humans: [{ player: player(host), powerups: [], emotes: [] }],
      // Pinned luck (0.5): this bot never knows the answer.
      bots: [
        {
          player: { ...player(0), id: 'b1', userId: null, isBot: true },
          brain: { skill: 750, pace: 0.3, strong: [], weak: [] },
        },
      ],
    },
    {
      toGame: () => {},
      toUser: (_userId, event, ...args) => {
        if (event === 'game:end') ends.push(args[0] as GameEndPayload);
      },
      toGameExcept: () => {},
    } satisfies GameEmitter,
    {
      finalize: finalizeMatch,
      undelivered: () => {},
      release: () => {},
      progress: () => {},
      draining: () => false,
      shown: () => {},
      onClosed: () => {},
    },
  );
  game.start();
  advance(COUNTDOWN);
  while (game.phase !== 'ended') {
    game.answer(`u${host}`, game.index, choiceAt(game).answer);
    advance(NEXT_QUESTION + TIME);
  }
  const [end] = ends;
  assert.equal(end.standings[0].id, `u${host}`, 'the room shows who won');
  assert.ok(!end.rewards!.achievements.includes('first_win'));
  assert.equal(getUser(host)!.wins, 0);
});

test('a question hidden before anyone has played the day leaves the day’s set; once someone has, the set stands', () => {
  const hide = (id: string) => {
    run('INSERT INTO hidden_questions (question_id, hidden_by, hidden_at) VALUES (?, NULL, ?)', id, Date.now());
    reloadQuestionBank();
  };
  try {
    const fresh = '2027-01-10';
    const wrong = dailyQuestions(fresh, 1)[3].id;
    hide(wrong);
    assert.equal(redrawDailyWithout(wrong, fresh), true);
    assert.ok(!dailyQuestions(fresh, 1).some((q) => q.id === wrong), 'drawn again without it');

    const started = '2027-01-11';
    const kept = dailyQuestions(started, 1)[3].id;
    run('INSERT INTO daily_results (user_id, day, started_at) VALUES (?, ?, ?)', account(), started, Date.now());
    hide(kept);
    assert.equal(redrawDailyWithout(kept, started), false);
    assert.ok(
      dailyQuestions(started, 1).some((q) => q.id === kept),
      'the board compares the same ten questions',
    );
  } finally {
    run('DELETE FROM hidden_questions');
    reloadQuestionBank();
  }
});

test('a new account plays people unrated for its first day and matches, and both sides are told why', () => {
  const a = account();
  const fresh = account({ fresh: true });
  const first = duel(a, fresh, null);
  assert.equal(first.end.rewards!.rating, null);
  assert.equal(first.end.rewards!.unrated, 'new_rival');
  assert.equal(first.deltaOf(fresh), null);
  assert.equal(duel(fresh, a, null).end.rewards!.unrated, 'new');

  // A day old but short of matches: still new.
  run('UPDATE users SET created_at = ?, games_played = ? WHERE id = ?', Date.now() - RATED_AFTER.ms, 9, fresh);
  assert.equal(duel(a, fresh, null).end.rewards!.unrated, 'new_rival');
  run('UPDATE users SET games_played = ? WHERE id = ?', RATED_AFTER.games, fresh);
  assert.notEqual(duel(a, fresh, null).end.rewards!.rating, null, 'a day old with the matches: rated');
});

test('a private room pays for beating people who played, and placements only so much a day', () => {
  const host = account();
  const idle = room(host, account(), { idle: true });
  assert.ok(!labels(idle).includes('Победа'), 'a second window that never answers is no rival');
  assert.equal(getUser(host)!.wins, 0, 'nor a win');

  assert.equal(getUser(host)!.room_xp, 0, 'nothing paid for it');
  // A win over one person pays 50 + 15: twelve of them would be 780, past the day's cap.
  const paid = Array.from({ length: 12 }, () => {
    const line = room(host, account()).rewards!.breakdown.find((l) => l.label.startsWith('Победа'));
    return line?.amount ?? 0;
  });
  assert.equal(
    paid.reduce((sum, n) => sum + n, 0),
    ROOM_PLACEMENT_XP_PER_DAY,
    `placements stop at the cap (${paid})`,
  );
  assert.equal(getUser(host)!.room_xp, ROOM_PLACEMENT_XP_PER_DAY);
});

test('the perfect-match bonus needs ten questions or more', () => {
  const short = room(account(), account(), { questions: 5 });
  assert.ok(!labels(short).includes('Перфектен мач'), labels(short).join(', '));
  assert.ok(labels(room(account(), account(), { questions: 10 })).includes('Перфектен мач'));
});

test('a win the other side walked out of before it got going is no win for "Дуелен инстинкт"', () => {
  const a = account();
  for (let i = 0; i < 10; i++) duel(a, account(), 0);
  const wins = one<{ n: number }>('SELECT COUNT(*) AS n FROM match_players WHERE user_id = ? AND won = 1', a)!.n;
  assert.equal(wins, 0);
  assert.equal(
    one('SELECT 1 AS x FROM user_achievements WHERE user_id = ? AND achievement_id = ?', a, 'duelist'),
    undefined,
  );
});

test('every answer a person gives is logged, with totals per question; too-perfect play is flagged for a moderator', () => {
  const [a, b] = [account(), account()];
  const { end } = duel(a, b, null);
  const logged = all<{ correct: number }>('SELECT correct FROM answers WHERE user_id = ?', a);
  assert.equal(logged.length, 10);
  assert.ok(logged.every((r) => r.correct === 1));
  assert.equal(all('SELECT 1 FROM answers WHERE user_id = ?', b).length, 10, 'the other side too');
  assert.ok(end.standings.length === 2);
  const totals = one<{ n: number }>('SELECT SUM(answered) AS n FROM question_stats')!.n;
  assert.ok(totals >= 20);

  // A script reading the answers off a copy of the bank: every medium and hard one right, in under a second.
  const bot = account();
  for (let i = 0; i < SUSPICIOUS.minAnswers; i++)
    run(
      `INSERT INTO answers (user_id, match_id, question_id, difficulty, correct, time_ms, answered_at)
       VALUES (?, 'm', ?, 'hard', 1, 800, ?)`,
      bot,
      `q${i}`,
      Date.now(),
    );
  const flagged = playCheck().suspicious.map((p) => p.user.id);
  assert.ok(flagged.includes(bot));
  assert.ok(!flagged.includes(a), 'ten answers say nothing yet');
});

test('a season counts only matches played out, and its reward goes by the peak from the tenth on', () => {
  const a = account();
  const row = () =>
    one<{ games: number; peak: number; reward_peak: number | null }>(
      "SELECT games, peak, reward_peak FROM season_ratings WHERE user_id = ? AND mode = 'duel'",
      a,
    )!;
  // Ten forfeits: the rating moves, but none is one of the season's games.
  for (let i = 0; i < 10; i++) recordRating(a, 'duel', 1290 - i, false, false);
  assert.equal(row().games, 0);
  // A lucky start doesn't make the season: the reward's peak starts at the tenth game.
  recordRating(a, 'duel', 1400, true);
  for (let i = 0; i < 8; i++) recordRating(a, 'duel', 1300, false);
  assert.equal(row().reward_peak, null);
  recordRating(a, 'duel', 1310, true);
  assert.deepEqual({ ...row() }, { games: 10, peak: 1400, reward_peak: 1310 });
  recordRating(a, 'duel', 1350, true);
  assert.equal(row().reward_peak, 1350);
});
