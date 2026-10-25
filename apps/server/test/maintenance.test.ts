// Housekeeping: expired sessions and old email links are cleared out; the database is snapshotted daily; accounts
// nobody has used for three years are deleted, after a warning.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// Server modules open the database on import — point them at a throwaway one first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-maintenance-'));
process.env.DB_PATH = path.join(tmp, 'maintenance.db');
process.env.BACKUP_KEEP_DAYS = '3';
process.env.MAIL_OUTBOX = path.join(tmp, 'outbox');
const { DatabaseSync } = await import('node:sqlite');
const { one, run } = await import('../src/db');
const { createSession } = await import('../src/auth');
const { INACTIVE_MS, INACTIVE_WARNING_MS, purgeExpired, retireInactiveAccounts, snapshot } = await import(
  '../src/maintenance'
);
const { getUser } = await import('../src/users');

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

test('an account unused for three years gets an email a month before it is deleted; signing in keeps it', () => {
  const now = Date.now();
  const user = (id: number, name: string, lastSeen: number, email: string | null = null, admin = 0) =>
    run(
      `INSERT INTO users (id, username, username_key, password_hash, created_at, last_seen_at, email, email_key,
         is_admin) VALUES (?, ?, ?, 'x', 0, ?, ?, ?, ?)`,
      id,
      name,
      name,
      lastSeen,
      email,
      email,
      admin,
    );
  const almost = now - INACTIVE_MS + DAY; // into the warning month
  user(10, 'pisano', almost, 'pisano@example.test');
  user(11, 'bez_imeil', now - INACTIVE_MS - DAY);
  user(12, 'vryshta_se', almost, 'vryshta@example.test');
  user(13, 'admin_star', now - INACTIVE_MS - DAY, null, 1);
  user(14, 'aktiven', now - DAY, 'aktiven@example.test');

  retireInactiveAccounts(now);
  assert.ok(getUser(10)?.inactivity_warned_at, 'warned, not deleted yet');
  assert.equal(getUser(11), undefined, 'nobody to warn: deleted at three years');
  assert.ok(getUser(13), 'administrators stay');
  assert.equal(getUser(14)?.inactivity_warned_at, null);
  const mails = fs
    .readdirSync(process.env.MAIL_OUTBOX!)
    .map((f) => JSON.parse(fs.readFileSync(path.join(process.env.MAIL_OUTBOX!, f), 'utf8')));
  assert.deepEqual(mails.map((m) => m.to).sort(), ['pisano@example.test', 'vryshta@example.test']);
  assert.match(mails[0].subject, /ще бъде изтрит след месец/);

  createSession(12); // signs in again
  assert.equal(getUser(12)?.inactivity_warned_at, null, 'the warning no longer stands');

  retireInactiveAccounts(now + INACTIVE_WARNING_MS + DAY);
  assert.equal(getUser(10), undefined, 'deleted a month after the warning');
  assert.ok(getUser(12), 'kept: in use again');
  assert.ok(getUser(14));
});
