// The database layer: per-player question history, and that hot queries use indexes instead of scanning tables
// (SQLite runs on the same thread as the game timers, so a slow query delays everyone's match).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, mock, test } from 'node:test';

// Server modules open the database on import — point them at a throwaway one first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-database-'));
process.env.DB_PATH = path.join(tmp, 'database.db');
const { all, run } = await import('../src/db');
const { markSeen, RECENT_LIMIT, recentFor } = await import('../src/questions');
const { installationSecret } = await import('../src/settings');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

run("INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (1, 'a', 'a', 'x', 0), (2, 'b', 'b', 'x', 0)");

test('recently seen questions are kept per player, newest first, up to the limit', () => {
  mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  try {
    const batches = Math.ceil(RECENT_LIMIT / 10) + 10;
    for (let b = 0; b < batches; b++) {
      markSeen(1, Array.from({ length: 10 }, (_, i) => `q-${b}-${i}`));
      mock.timers.tick(60_000);
    }
    const seen = recentFor([1]);
    assert.equal(seen.size, RECENT_LIMIT, 'bounded per player');
    assert.ok(seen.has(`q-${batches - 1}-0`) && !seen.has('q-0-0'), 'the oldest ones make room');

    markSeen(1, ['q-0-0']);
    assert.ok(recentFor([1]).has('q-0-0'), 'seeing a question again makes it recent');

    markSeen(2, ['q-shared', 'q-only-b']);
    assert.ok(recentFor([1, 2]).has('q-only-b'), 'a match avoids what any of its players saw');
    assert.equal(recentFor([]).size, 0);
  } finally {
    mock.timers.reset();
  }
});

const plan = (sql: string, ...params: (string | number)[]) =>
  all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...params)
    .map((r) => r.detail)
    .join(' | ');

test('hot queries use indexes', () => {
  const cases: [string, string, (string | number)[], RegExp][] = [
    ['level leaderboard', 'SELECT * FROM users ORDER BY xp DESC, id ASC LIMIT 50', [], /users_xp/],
    ['your level rank', 'SELECT COUNT(*) + 1 AS n FROM users WHERE xp > ?', [100], /users_xp/],
    [
      'season leaderboard',
      'SELECT * FROM season_ratings WHERE season = ? AND mode = ? AND games > 0 ORDER BY rating DESC LIMIT 50',
      ['2026-10', 'duel'],
      /season_board/,
    ],
    ['daily leaderboard', 'SELECT * FROM daily_results WHERE day = ? ORDER BY score DESC LIMIT 50', ['2026-10-25'], /daily_board/],
    ['expired sessions cleanup', 'DELETE FROM sessions WHERE expires_at < ?', [0], /sessions_expiry/],
    ['question history', 'SELECT question_id FROM seen_questions WHERE user_id IN (?, ?)', [1, 2], /PRIMARY KEY|seen_questions/],
    ['match history', 'SELECT * FROM match_players WHERE user_id = ?', [1], /match_players_user/],
    ['approved questions per author', 'SELECT COUNT(*) AS n FROM questions WHERE author_id = ?', [1], /questions_author/],
  ];
  for (const [name, sql, params, index] of cases) {
    const p = plan(sql, ...params);
    assert.match(p, index, `${name}: ${p}`);
    // An index-ordered walk ("SCAN users USING INDEX …" + LIMIT) is fine; a bare table scan or an extra sort isn't.
    assert.doesNotMatch(p, /SCAN \w+(?! USING)(?:$| \|)|TEMP B-TREE/, `${name} scans or sorts the whole table: ${p}`);
  }
});

test("an installation's secrets are random, made once and kept", () => {
  const seed = installationSecret('daily-seed');
  assert.ok(seed.length >= 40);
  assert.equal(installationSecret('daily-seed'), seed, 'the same every time');
  assert.notEqual(installationSecret('another'), seed);
});
