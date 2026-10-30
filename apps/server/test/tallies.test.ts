// The running tallies (tallies.ts): what's added match by match is what counting from the rows gives, the answer log's
// pruning takes from them, and a start after anything but this release's clean stop counts them again.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { Difficulty } from '@quiz/shared';

// Server modules open the database on import — point them at a throwaway one first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-tallies-'));
process.env.DB_PATH = path.join(tmp, 'tallies.db');
const { all, one, run } = await import('../src/db');
const { accurateAnswerers, catchUpTallies, keepTallies, modeTallies, tallyMatchPlayer } = await import(
  '../src/tallies'
);
const { ANSWER_LOG_DAYS, pruneAnswers, recordAnswers } = await import('../src/answers');
const { loadAggregate } = await import('../src/achievements');
type AnswerLogEntry = import('../src/game/Game').AnswerLogEntry;

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

for (const id of [1, 2, 3, 4])
  run(
    "INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (?, ?, ?, 'x', 0)",
    id,
    `p${id}`,
    `p${id}`,
  );

type Row = [
  player: string,
  user: number | null,
  placement: number,
  won: number | null,
  left: number,
  team: number | null,
];

let matches = 0;
/** A match as rewards.ts settles it: its rows first, then each person's tally. */
function settle(mode: string, rows: Row[], room: string | null = null) {
  const id = `m${++matches}`;
  run(
    `INSERT INTO matches (id, mode, ranked, room_code, player_count, question_count, started_at, ended_at)
     VALUES (?, ?, 0, ?, ?, 10, 0, ?)`,
    id,
    mode,
    room,
    rows.length,
    matches,
  );
  for (const [player, user, placement, won, left, team] of rows)
    run(
      `INSERT INTO match_players (match_id, player_id, user_id, name, avatar, is_bot, placement, score, correct, faced,
         best_streak, left_match, team, won)
       VALUES (?, ?, ?, ?, '🙂', ?, ?, 0, 0, 10, 0, ?, ?, ?)`,
      id,
      player,
      user,
      player,
      user === null ? 1 : 0,
      placement,
      left,
      team,
      won,
    );
  for (const [player, user] of rows) if (user !== null) tallyMatchPlayer(id, player);
}

const table = () => all('SELECT * FROM mode_stats ORDER BY user_id, mode');

test('matches add up per mode, the way counting every match did', () => {
  settle('duel', [
    ['a', 1, 1, 1, 0, null],
    ['b', 2, 2, 0, 0, null],
  ]);
  settle('solo', [['a', 1, 1, 0, 0, null]]);
  // Two a side from the queue, against a person and a bot: a team win for both winners.
  settle('teams', [
    ['a', 1, 1, 1, 0, 0],
    ['b', 2, 1, 1, 0, 0],
    ['c', 3, 2, 0, 0, 1],
    ['bot', null, 2, null, 0, 1],
  ]);
  // In a private room against bots only: practice, no team win.
  settle(
    'teams',
    [
      ['a', 1, 1, 1, 0, 0],
      ['b', 2, 1, 1, 0, 0],
      ['bot1', null, 2, null, 0, 1],
      ['bot2', null, 2, null, 0, 1],
    ],
    '123456',
  );
  // First, but walked out: not a first place on the profile, and no win.
  settle('squad', [
    ['c', 3, 1, 0, 1, null],
    ['d', 4, 2, 0, 0, null],
    ['a', 1, 3, 0, 0, null],
  ]);
  // A row older code saved, its win not decided yet (repair() decides it at the next start).
  settle('duel', [
    ['a', 1, 1, null, 0, null],
    ['d', 4, 2, null, 0, null],
  ]);

  const byMode = Object.fromEntries(modeTallies(1).map((t) => [t.mode, { ...t }]));
  assert.deepEqual(byMode.duel, { mode: 'duel', games: 2, firsts: 2, wins: 1, teamWins: 0, placed: 2, placements: 2 });
  assert.deepEqual(byMode.solo, { mode: 'solo', games: 1, firsts: 0, wins: 0, teamWins: 0, placed: 0, placements: 0 });
  assert.equal(byMode.teams.teamWins, 1, 'the queue match, not the room against bots');
  assert.equal(byMode.teams.wins, 2);
  assert.deepEqual(byMode.squad, {
    mode: 'squad',
    games: 1,
    firsts: 0,
    wins: 0,
    teamWins: 0,
    placed: 1,
    placements: 3,
  });
  assert.equal(modeTallies(3).find((t) => t.mode === 'squad')!.firsts, 0, 'a walkout isn’t a first place');

  const agg = loadAggregate(1);
  assert.deepEqual(agg.modeWins, { duel: 1, teams: 2 });
  assert.equal(agg.teamWins, 1);

  // Counting again from the rows gives the same.
  const kept = table();
  assert.equal(catchUpTallies(), true, 'no clean stop marked: counted again');
  assert.deepEqual(table(), kept);
});

test('a clean stop marks them kept; the next start uses them, and the one after a crash counts again', () => {
  keepTallies();
  run('UPDATE mode_stats SET games = 99 WHERE user_id = 4');
  assert.equal(catchUpTallies(), false, 'kept: nothing counted');
  assert.equal(one<{ games: number }>("SELECT games FROM mode_stats WHERE user_id = 4 AND mode = 'squad'")!.games, 99);
  // No stop marked since that start (a crash, or an older release ran): counted from the rows.
  assert.equal(catchUpTallies(), true);
  assert.equal(one<{ games: number }>("SELECT games FROM mode_stats WHERE user_id = 4 AND mode = 'squad'")!.games, 1);
});

function answer(questionId: string, difficulty: Difficulty, correct: boolean): AnswerLogEntry {
  return {
    questionId,
    index: 0,
    category: 'history',
    difficulty,
    choice: correct ? 0 : 1,
    guess: null,
    closeness: null,
    arranged: null,
    placed: null,
    correct,
    timeMs: 1500,
    points: correct ? 900 : 0,
    powerup: null,
    retried: false,
    slow: false,
    out: false,
  };
}

test('the flag list’s tallies: harder answers only, and old ones leave them as they leave the log', async () => {
  const DAY = 24 * 60 * 60_000;
  const now = Date.now();
  const old = now - (ANSWER_LOG_DAYS + 1) * DAY;
  recordAnswers('old', 1, [answer('q1', 'hard', true), answer('q2', 'medium', false), answer('q3', 'easy', true)], old);
  recordAnswers('new', 1, [answer('q4', 'hard', true), answer('q5', 'easy', false)], now);
  recordAnswers('new', 2, [answer('q4', 'medium', true)], now);
  const tally = (user: number) =>
    one<object>('SELECT answered, correct, last_at FROM answer_tallies WHERE user_id = ?', user);
  assert.deepEqual({ ...tally(1) }, { answered: 3, correct: 2, last_at: now });

  assert.equal(await pruneAnswers(now), 3);
  assert.deepEqual({ ...tally(1) }, { answered: 1, correct: 1, last_at: now }, 'the old hard and medium ones went');
  assert.deepEqual({ ...tally(2) }, { answered: 1, correct: 1, last_at: now });

  const kept = all('SELECT * FROM answer_tallies ORDER BY user_id');
  assert.equal(catchUpTallies(), true);
  assert.deepEqual(all('SELECT * FROM answer_tallies ORDER BY user_id'), kept, 'counting again gives the same');

  assert.deepEqual(
    accurateAnswerers(1, 0.95, 10).map((r) => r.user_id),
    [1, 2],
  );
  assert.deepEqual(accurateAnswerers(2, 0.95, 10), [], 'too few answers');
});
