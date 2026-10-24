// Housekeeping: expired sessions and old email links are cleared out.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// Server modules open the database on import — point them at a throwaway one first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-maintenance-'));
process.env.DB_PATH = path.join(tmp, 'maintenance.db');
const { one, run } = await import('../src/db');
const { purgeExpired } = await import('../src/maintenance');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const DAY = 24 * 60 * 60_000;
const count = (table: string) => one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;

test('expired sessions and old email links are purged', () => {
  const now = Date.now();
  run("INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (1, 'a', 'a', 'x', 0)");
  run("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ('live', 1, 0, ?), ('dead', 1, 0, ?)", now + DAY, now - 1);
  run(
    `INSERT INTO email_tokens (token_hash, user_id, purpose, created_at, expires_at)
     VALUES ('fresh', 1, 'reset', 0, ?), ('recent', 1, 'reset', 0, ?), ('old', 1, 'reset', 0, ?)`,
    now + DAY,
    now - DAY,
    now - 30 * DAY,
  );

  purgeExpired(now);

  assert.equal(count('sessions'), 1, 'only the live session stays');
  assert.equal(count('email_tokens'), 2, 'links expired over a week ago are gone');
});
