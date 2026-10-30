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
const { all, one, run } = await import('../src/db');
const { createSession } = await import('../src/auth');
const { INACTIVE_MS, INACTIVE_WARNING_MS, purgeExpired, retireInactiveAccounts, snapshot } = await import(
  '../src/maintenance'
);
const { getUser } = await import('../src/users');
const { ANSWER_LOG_DAYS, pruneAnswers } = await import('../src/answers');

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

test('old answers are all pruned however many there are, a batch at a time; recent ones stay', async () => {
  const now = Date.now();
  const insert = (n: number, at: number) =>
    run(
      `WITH RECURSIVE i(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM i WHERE x < ?)
       INSERT INTO answers (user_id, match_id, question_id, difficulty, correct, time_ms, answered_at)
       SELECT 1, 'm', 'q' || x, 'easy', 1, 1000, ? FROM i`,
      n,
      at,
    );
  // More than two batches' worth past the limit: a fixed amount per run fell behind once enough people played.
  insert(12_345, now - (ANSWER_LOG_DAYS + 1) * DAY);
  insert(10, now - DAY);
  // The matches going on get their turn between batches: the event loop goes round each time.
  let turns = 0;
  const matches = setInterval(() => turns++, 0);
  try {
    assert.equal(await pruneAnswers(now), 12_345);
  } finally {
    clearInterval(matches);
  }
  assert.equal(count('answers'), 10, 'the recent ones stay');
  assert.ok(turns >= 2, `three batches, a turn for the matches between each (${turns})`);
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

test('a deleted account leaves no name: not in others’ matches, not where its recording played; a banned one leaves a hash of its e-mail for a year', async () => {
  const { bannedBefore, eraseAccount } = await import('../src/account');
  const { DELETED_NAME } = await import('../src/users');
  const now = Date.now();
  run(
    `INSERT INTO users (id, username, username_key, password_hash, created_at, email, email_key, banned_until, ban_basis)
     VALUES (30, 'zapisan', 'zapisan', 'x', 0, 'Zap@Example.test', 'zap@example.test', ?, 'cheating'),
            (31, 'drug', 'drug', 'x', 0, NULL, NULL, NULL, NULL)`,
    now + DAY,
  );
  run(
    "INSERT INTO matches (id, mode, ranked, player_count, started_at, ended_at, question_count) VALUES ('rec', 'duel', 1, 2, 0, 0, 10)",
  );
  run(
    `INSERT INTO match_players (match_id, player_id, user_id, record_owner_id, name, avatar, is_bot, placement, score,
       correct, faced, best_streak, left_match, won)
     VALUES ('rec', 'r9', NULL, 30, 'zapisan', 'fox', 1, 2, 10, 1, 10, 1, 0, 0),
            ('rec', 'u31', 31, NULL, 'drug', 'fox', 0, 1, 20, 2, 10, 2, 0, 1)`,
  );
  eraseAccount(30);
  assert.deepEqual(
    all<object>(
      "SELECT player_id, name, record_owner_id FROM match_players WHERE match_id = 'rec' ORDER BY player_id",
    ).map((r) => ({ ...r })),
    [
      { player_id: 'r9', name: DELETED_NAME, record_owner_id: null },
      { player_id: 'u31', name: 'drug', record_owner_id: null },
    ],
  );
  const kept = bannedBefore('zap@EXAMPLE.test ');
  assert.equal(kept?.basis, 'cheating', 'the same address, however written');
  assert.equal(bannedBefore('other@example.test'), null);
  assert.equal(
    JSON.stringify(all('SELECT * FROM erased_bans')).includes('example'),
    false,
    'a keyed hash, not the address',
  );
  purgeExpired(now + 366 * DAY);
  assert.equal(bannedBefore('zap@example.test'), null, 'gone after a year');
});

test('moderators get one email a day about what waits, from 09:00, and an alert at most once a day per thing', async () => {
  const { alertModerators, moderatorDigest } = await import('../src/alerts');
  run(
    `INSERT INTO users (id, username, username_key, password_hash, created_at, email, email_key, is_admin)
     VALUES (20, 'moderator', 'moderator', 'x', 0, 'mod@example.test', 'mod@example.test', 1)`,
  );
  const toModerator = () =>
    fs
      .readdirSync(process.env.MAIL_OUTBOX!)
      .map((f) => JSON.parse(fs.readFileSync(path.join(process.env.MAIL_OUTBOX!, f), 'utf8')))
      .filter((m) => m.to === 'mod@example.test');
  // 08:00 and 10:00 in Sofia (UTC+2 in winter).
  const early = Date.UTC(2026, 10, 2, 6);
  const later = Date.UTC(2026, 10, 2, 8);

  assert.equal(moderatorDigest(later), false, 'nothing waiting, no mail');
  run(
    `INSERT INTO question_submissions (user_id, category, difficulty, q, options, answer, status, created_at)
     VALUES (20, 'general', 'easy', 'Въпрос?', '["а","б","в","г"]', 0, 'pending', 0)`,
  );
  run("DELETE FROM settings WHERE key = 'mod_digest_day'");
  assert.equal(moderatorDigest(early), false, 'not before nine');
  assert.equal(moderatorDigest(later), true);
  assert.equal(moderatorDigest(later + 60 * 60_000), false, 'once a day');
  const [digest] = toModerator();
  assert.match(digest.text, /Предложени въпроси: 1 \(най-старото чака \d+ дни\)/, 'and how long the oldest has waited');

  alertModerators('question:x', 'Сигнали', ['…'], { now: later });
  alertModerators('question:x', 'Сигнали', ['…'], { now: later + 60_000 });
  alertModerators('question:y', 'Сигнали', ['…'], { now: later });
  assert.equal(toModerator().length, 3, 'one alert per question per day');
});
