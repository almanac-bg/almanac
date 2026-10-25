// Housekeeping: expired sessions and old email links are cleared out; the database is snapshotted daily.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// Server modules open the database on import — point them at a throwaway one first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-maintenance-'));
process.env.DB_PATH = path.join(tmp, 'maintenance.db');
process.env.BACKUP_KEEP_DAYS = '3';
const { DatabaseSync } = await import('node:sqlite');
const { one, run } = await import('../src/db');
const { purgeExpired, snapshot } = await import('../src/maintenance');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const DAY = 24 * 60 * 60_000;
const count = (table: string) => one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;

test('expired sessions and old email links are purged', () => {
  const now = Date.now();
  run("INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (1, 'a', 'a', 'x', 0)");
  run(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ('live', 1, 0, ?), ('dead', 1, 0, ?)",
    now + DAY,
    now - 1,
  );
  run(
    `INSERT INTO email_tokens (token_hash, user_id, purpose, created_at, expires_at)
     VALUES ('fresh', 1, 'reset', 0, ?), ('recent', 1, 'reset', 0, ?), ('old', 1, 'reset', 0, ?)`,
    now + DAY,
    now - DAY,
    now - 30 * DAY,
  );

  purgeExpired(now);

  assert.equal(count('sessions'), 1, 'only the live session stays');
  assert.equal(count('email_tokens'), 1, 'expired links are gone right away');
});

test('daily snapshots: one per day, a working copy, only the newest kept', async () => {
  const dir = path.join(tmp, 'backups');
  const day = (d: number) => Date.UTC(2026, 9, d, 12);
  const first = await snapshot(day(1), dir);
  assert.ok(first?.endsWith('quiz-2026-10-01.db'));
  assert.equal(await snapshot(day(1), dir), null, 'one snapshot per day');

  const copy = new DatabaseSync(first!, { readOnly: true });
  assert.equal((copy.prepare('SELECT username FROM users WHERE id = 1').get() as { username: string }).username, 'a');
  copy.close();

  for (const d of [2, 3, 4, 5]) await snapshot(day(d), dir);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['quiz-2026-10-03.db', 'quiz-2026-10-04.db', 'quiz-2026-10-05.db']);
});
