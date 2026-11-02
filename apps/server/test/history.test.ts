// Match history within bounds (history.ts): team wins kept on each person's row first, then bots' rows after a month
// and whole matches after two years — and the running tallies, counted again from what's left, stay as they were.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-history-'));
process.env.DB_PATH = path.join(tmp, 'history.db');
const { all, one, run } = await import('../src/db');
const { catchUpTallies, tallyMatchPlayer } = await import('../src/tallies');
const { HISTORY, pruneHistory } = await import('../src/history');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const DAY = 24 * 60 * 60_000;
const now = Date.now();
for (const id of [1, 2])
  run(
    "INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (?, ?, ?, 'x', 0)",
    id,
    `p${id}`,
    `p${id}`,
  );

/** A match: [player, user (null: a bot), placement, won, team]; tallied as the save does. */
function match(
  id: string,
  mode: string,
  endedAt: number,
  rows: [string, number | null, number, number, number | null][],
) {
  run(
    `INSERT INTO matches (id, mode, ranked, room_code, player_count, question_count, started_at, ended_at)
     VALUES (?, ?, 1, NULL, ?, 10, ?, ?)`,
    id,
    mode,
    rows.length,
    endedAt - 60_000,
    endedAt,
  );
  for (const [player, user, placement, won, team] of rows)
    run(
      `INSERT INTO match_players (match_id, player_id, user_id, name, avatar, is_bot, placement, score, correct, faced,
         best_streak, left_match, team, won)
       VALUES (?, ?, ?, ?, '🙂', ?, ?, 0, 0, 10, 0, 0, ?, ?)`,
      id,
      player,
      user,
      player,
      user === null ? 1 : 0,
      placement,
      team,
      won,
    );
  for (const [player, user] of rows) if (user !== null) tallyMatchPlayer(id, player);
}

test('team wins are kept on the rows, bots go after a month and matches after two years; the tallies stand', async () => {
  // Отбори a month and a day ago: the two people and their bots won, two bots lost. From before team_win (NULL).
  match('teams-old', 'teams', now - (HISTORY.botDays + 1) * DAY, [
    ['u1', 1, 1, 1, 0],
    ['u2', 2, 1, 1, 0],
    ['b1', null, 2, 0, 1],
    ['b2', null, 2, 0, 1],
  ]);
  // A Роял three years ago, and a Дуел today against a bot.
  match('royale-ancient', 'royale', now - 3 * 365 * DAY, [
    ['u1', 1, 1, 1, null],
    ['b3', null, 2, 0, null],
  ]);
  match('duel-today', 'duel', now - 60_000, [
    ['u1', 1, 2, 0, null],
    ['b4', null, 1, 1, null],
  ]);
  const before = all('SELECT * FROM mode_stats ORDER BY user_id, mode');
  assert.ok(
    all<{ team_wins: number }>("SELECT team_wins FROM mode_stats WHERE mode = 'teams'").every((r) => r.team_wins === 1),
  );

  // Bots' rows of both old matches (three), then the ancient match itself.
  assert.deepEqual(await pruneHistory(now), { bots: 3, matches: 1 });
  // Kept on the rows while the bots were still there to work it out from.
  assert.deepEqual(
    all<{ team_win: number }>("SELECT team_win FROM match_players WHERE match_id = 'teams-old' ORDER BY player_id").map(
      (r) => r.team_win,
    ),
    [1, 1],
    "the two people's rows, the bots' gone",
  );
  assert.equal(one<{ n: number }>("SELECT COUNT(*) AS n FROM matches WHERE id = 'royale-ancient'")!.n, 0);
  assert.equal(one<{ n: number }>("SELECT COUNT(*) AS n FROM match_players WHERE match_id = 'duel-today'")!.n, 2);
  // The running totals are what they were, and the same when counted again from what's left (the team wins from
  // the rows; the old Роял's game and win are kept only by the totals, as the policy says).
  assert.deepEqual(all('SELECT * FROM mode_stats ORDER BY user_id, mode'), before);
  run("DELETE FROM settings WHERE key IN ('tallied_to', 'tallies_kept')");
  assert.equal(catchUpTallies(), true);
  assert.deepEqual(
    all<{ user_id: number; team_wins: number }>(
      "SELECT user_id, team_wins FROM mode_stats WHERE mode = 'teams' ORDER BY user_id",
    ).map((r) => ({ ...r })),
    [
      { user_id: 1, team_wins: 1 },
      { user_id: 2, team_wins: 1 },
    ],
  );

  // A second run has nothing left to do, and picks up where the last stopped.
  assert.deepEqual(await pruneHistory(now), { bots: 0, matches: 0 });
});
