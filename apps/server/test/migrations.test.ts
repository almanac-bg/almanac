// The migration chain on a database with players in it. Every other test starts from an empty file, where the steps
// that move data (hashing session tokens, backfilling last-seen times…) have nothing to work on; a real database on
// deploy has everything. This one is a copy of what the first release left on disk (fixtures/schema-v1.sql).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { seasonKey } from '@quiz/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-migrations-'));
const file = path.join(tmp, 'old.db');
const old = new DatabaseSync(file);
old.exec(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/schema-v1.sql'), 'utf8'));
old.close();

// The server's database module migrates the file it opens, on import.
process.env.DB_PATH = file;
process.env.BACKUP_DIR = path.join(tmp, 'backups');
const { all, one, SCHEMA_VERSION } = await import('../src/db');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const DAY = 86_400_000;
/** Rows as plain objects (SQLite's have no prototype, which deep equality counts). */
const rows = (sql: string) => all<Record<string, unknown>>(sql).map((r) => ({ ...r }));

test('a first-release database comes up to the current schema, sound', () => {
  assert.equal(one<{ user_version: number }>('PRAGMA user_version')?.user_version, SCHEMA_VERSION);
  assert.deepEqual(rows('PRAGMA integrity_check'), [{ integrity_check: 'ok' }]);
  assert.deepEqual(rows('PRAGMA foreign_key_check'), []);
  // Nothing lost on the way.
  assert.equal(one<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n, 2);
  assert.equal(one<{ n: number }>('SELECT COUNT(*) AS n FROM match_players')?.n, 2);
  assert.equal(one<{ xp: number }>('SELECT xp FROM users WHERE id = 1')?.xp, 420);
});

test('the steps that move data did it on the rows that were there', () => {
  // v2: the first account runs the site; the ratings so far open the current season.
  assert.deepEqual(rows('SELECT id, is_admin FROM users ORDER BY id'), [
    { id: 1, is_admin: 1 },
    { id: 2, is_admin: 0 },
  ]);
  assert.deepEqual(rows('SELECT season, mode, rating, peak, games, wins FROM season_ratings WHERE user_id = 1'), [
    { season: seasonKey(), mode: 'duel', rating: 1084.5, peak: 1084.5, games: 3, wins: 2 },
  ]);
  // v7: the session survives, stored as a hash of its token (the browser still holds the token itself).
  const hash = createHash('sha256').update('raw-session-token-of-ana').digest('base64url');
  assert.deepEqual(rows('SELECT token FROM sessions'), [{ token: hash }]);
  // v8: old accounts are full accounts, not guests.
  assert.equal(one<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE is_guest = 0')?.n, 2);
  // v11 and v13: everyone has a last-seen time — the session's start for Ана (it expires 30 days after), the sign-up
  // for boris, who never signed in.
  assert.deepEqual(rows('SELECT id, last_seen_at FROM users ORDER BY id'), [
    { id: 1, last_seen_at: 1_763_592_000_000 - 30 * DAY },
    { id: 2, last_seen_at: 1_760_500_000_000 },
  ]);
});

test('the database as it was is kept beside the backups before migrating', () => {
  const copy = path.join(tmp, 'backups', `quiz-v1-before-v${SCHEMA_VERSION}.db`);
  assert.ok(fs.existsSync(copy), copy);
  const saved = new DatabaseSync(copy, { readOnly: true });
  try {
    assert.equal((saved.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 1);
    assert.equal(
      (saved.prepare('SELECT token FROM sessions').get() as { token: string }).token,
      'raw-session-token-of-ana',
    );
  } finally {
    saved.close();
  }
});

test('a database from newer code is refused, not opened', () => {
  const newer = path.join(tmp, 'newer.db');
  const db = new DatabaseSync(newer);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  db.close();
  const child = spawnSync(process.execPath, ['--import', 'tsx', '-e', "await import('./src/db.ts')"], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DB_PATH: newer, BACKUP_DIR: 'off' },
    encoding: 'utf8',
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, new RegExp(`schema v${SCHEMA_VERSION + 1}, but this code only knows v${SCHEMA_VERSION}`));
});
