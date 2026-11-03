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
import { seasonKey } from '@almanac/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-migrations-'));
const file = path.join(tmp, 'old.db');
const old = new DatabaseSync(file);
old.exec(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/schema-v1.sql'), 'utf8'));
old.close();

// The server's database module migrates the file it opens, on import.
process.env.DB_PATH = file;
process.env.BACKUP_DIR = path.join(tmp, 'backups');
const { all, one, SCHEMA_VERSION, schemaFloor } = await import('../src/db');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/**
 * Starts the database module on this file, as a server's start would (migrating it); `to`: only this far (MIGRATE_TO), a
 * database as an older release left it.
 */
const bootDb = (file: string, to?: number) =>
  spawnSync(process.execPath, ['--import', 'tsx', '-e', "await import('./src/db.ts')"], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DB_PATH: file, BACKUP_DIR: 'off', ...(to !== undefined && { MIGRATE_TO: String(to) }) },
    encoding: 'utf8',
  });

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
  // v15: how each name looks, so a new one can't pass for it (Ана's А and а are Latin twins; н has none).
  assert.deepEqual(rows('SELECT id, username_shape FROM users ORDER BY id'), [
    { id: 1, username_shape: 'A\u043da' },
    { id: 2, username_shape: 'boris' },
  ]);
});

test('the database as it was is kept beside the backups before migrating', () => {
  const copy = path.join(tmp, 'backups', `almanac-v1-before-v${SCHEMA_VERSION}.db`);
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

test('the database knows the oldest code that can run on it: the one its last breaking step needs', () => {
  // Every step up to v14 counts as breaking (they're from before steps were marked); v15–v48 are compatible; v49 (the
  // ids of „Моите знания“'s achievements and quest, renamed) is breaking, v50 compatible, and v51 (the last of the old
  // names: the quests for козове, Трио's matches) breaking; v52 (a question flag outlives its account) and v53 (the set a
  // room played) compatible.
  assert.equal(schemaFloor(), 51);
});

test('a rollback runs on a database whose newer steps were all compatible, and not past a breaking one', () => {
  const file = path.join(tmp, 'rollback.db');
  const boot = () =>
    spawnSync(process.execPath, ['--import', 'tsx', '-e', "await import('./src/db.ts')"], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: { ...process.env, DB_PATH: file, BACKUP_DIR: 'off' },
      encoding: 'utf8',
    });
  assert.equal(boot().status, 0, 'a new database');
  const db = new DatabaseSync(file);
  try {
    // As if a newer release had added a compatible step, and the one before it then ran here again and signed someone
    // up — without the name's shape, which it didn't know about.
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    db.exec(
      "INSERT INTO users (username, username_key, password_hash, created_at) VALUES ('\u041dristo', 'x', 'x', 0)",
    );
    const rollback = boot();
    assert.equal(rollback.status, 0, rollback.stderr);
    assert.match(rollback.stderr, /every step since is compatible/);
    assert.equal(
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      SCHEMA_VERSION + 1,
    );
    assert.equal(
      (db.prepare("SELECT username_shape FROM users WHERE username_key = 'x'").get() as { username_shape: string })
        .username_shape,
      'Hristo',
      'what the older release left out is filled in on the next start',
    );

    // A breaking step since: the floor is past this code.
    db.prepare("UPDATE settings SET value = ? WHERE key = 'schema_floor'").run(String(SCHEMA_VERSION + 1));
    const refused = boot();
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /this code only knows/);
  } finally {
    db.close();
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

test('„Моят алманах“ became „Моите знания“: its achievements and quest move to their new ids, kept as they were', () => {
  const file = path.join(tmp, 'knowledge.db');
  const boot = () => bootDb(file);
  assert.equal(bootDb(file, 48).status, 0, 'a database as v48 left it');
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (1, 'ana', 'ana', 'x', 0);
      INSERT INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES
        (1, 'almanac_100', 10), (1, 'almanac_500', 20), (1, 'first_game', 5);
      INSERT INTO quest_progress (user_id, day, quest, progress) VALUES (1, '2026-11-02', 'almanac5', 3);
    `);
    const migrated = boot();
    assert.equal(migrated.status, 0, migrated.stderr);
    assert.deepEqual(
      db
        .prepare('SELECT achievement_id AS id, unlocked_at AS at FROM user_achievements ORDER BY at')
        .all()
        .map((r) => ({ ...r })),
      [
        { id: 'first_game', at: 5 },
        { id: 'knowledge_100', at: 10 },
        { id: 'knowledge_500', at: 20 },
      ],
    );
    assert.deepEqual(
      { ...db.prepare('SELECT quest, progress FROM quest_progress').get() },
      { quest: 'knowledge5', progress: 3 },
    );
  } finally {
    db.close();
  }
});

test('the last of the old names go: the quests for козове are powerup ones, and Трио’s matches are Арена’s', () => {
  const file = path.join(tmp, 'old-names.db');
  const boot = () => bootDb(file);
  assert.equal(bootDb(file, 50).status, 0, 'a database as v50 left it');
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (1, 'ana', 'ana', 'x', 0);
      INSERT INTO quest_progress (user_id, day, quest, progress) VALUES
        (1, '2026-11-03', 'joker1', 1), (1, '2026-11-03', 'jokers3', 2), (1, '2026-11-03', 'correct15', 4);
      INSERT INTO matches (id, mode, ranked, player_count, question_count, started_at, ended_at) VALUES
        ('m1', 'trio', 1, 3, 10, 1, 2), ('m2', 'duel', 1, 2, 10, 3, 4);
      INSERT INTO season_ratings (user_id, season, mode, rating, peak) VALUES
        (1, '2026-10', 'trio', 1100, 1120), (1, '2026-10', 'squad', 1050, 1060);
      INSERT INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (1, 'trio_win', 10), (1, 'first_game', 5);
      INSERT INTO settings (key, value) VALUES ('tallies_kept', 'x'), ('tallied_to', 'y');
    `);
    const migrated = boot();
    assert.equal(migrated.status, 0, migrated.stderr);
    const all = (sql: string) =>
      db
        .prepare(sql)
        .all()
        .map((r) => ({ ...r }));
    assert.deepEqual(all('SELECT quest, progress FROM quest_progress ORDER BY quest'), [
      { quest: 'correct15', progress: 4 },
      { quest: 'powerup1', progress: 1 },
      { quest: 'powerups3', progress: 2 },
    ]);
    assert.deepEqual(all('SELECT id, mode FROM matches ORDER BY id'), [
      { id: 'm1', mode: 'squad' },
      { id: 'm2', mode: 'duel' },
    ]);
    assert.deepEqual(all('SELECT mode FROM season_ratings'), [{ mode: 'squad' }]);
    assert.deepEqual(all('SELECT achievement_id AS id FROM user_achievements'), [{ id: 'first_game' }]);
    // Counted again from the rows at the next start (tallies.ts).
    assert.deepEqual(all("SELECT key FROM settings WHERE key IN ('tallies_kept', 'tallied_to')"), []);
  } finally {
    db.close();
  }
});

test('a question flag outlives the account that sent it, without its name or words (v52)', () => {
  const file = path.join(tmp, 'flags.db');
  const boot = () => bootDb(file);
  // As v51 left it: a flag went with its account (ON DELETE CASCADE).
  assert.equal(bootDb(file, 51).status, 0, 'a database as v51 left it');
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES
        (1, 'ana', 'ana', 'x', 0), (2, 'boris', 'boris', 'x', 0);
      INSERT INTO question_reports (id, question_id, user_id, reason, details, status, created_at, resolved_by, question_hash)
        VALUES (1, 'q1', 1, 'wrong', 'Годината е 1878.', 'open', 10, NULL, 'h1'),
               (2, 'q1', 2, 'wrong', 'Не е 1876.', 'resolved', 20, 1, 'h1');
    `);
    const migrated = boot();
    assert.equal(migrated.status, 0, migrated.stderr);
    const all = (sql: string) =>
      db
        .prepare(sql)
        .all()
        .map((r) => ({ ...r }));
    assert.deepEqual(
      all('SELECT id, user_id, details, status, resolved_by, question_hash FROM question_reports ORDER BY id'),
      [
        { id: 1, user_id: 1, details: 'Годината е 1878.', status: 'open', resolved_by: null, question_hash: 'h1' },
        { id: 2, user_id: 2, details: 'Не е 1876.', status: 'resolved', resolved_by: 1, question_hash: 'h1' },
      ],
    );
    assert.deepEqual(
      all("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'question_reports' ORDER BY name"),
      [
        'question_reports_once',
        'question_reports_open',
        'question_reports_recent',
        'question_reports_resolver',
        'question_reports_user',
      ].map((name) => ({ name })),
    );
    // An account erased, as older code (which doesn't clear the words) would: the flag stays, nameless…
    db.exec('PRAGMA foreign_keys = ON; DELETE FROM users WHERE id = 2;');
    assert.deepEqual(all('SELECT id, user_id, details FROM question_reports ORDER BY id'), [
      { id: 1, user_id: 1, details: 'Годината е 1878.' },
      { id: 2, user_id: null, details: 'Не е 1876.' },
    ]);
    // …and its words go at the next start (repair).
    assert.equal(boot().status, 0);
    assert.deepEqual(all('SELECT id, details FROM question_reports ORDER BY id'), [
      { id: 1, details: 'Годината е 1878.' },
      { id: 2, details: '' },
    ]);
    const floor = db.prepare("SELECT value FROM settings WHERE key = 'schema_floor'").get() as { value: string };
    assert.equal(floor.value, '51', 'compatible: the code before it runs on it');
  } finally {
    db.close();
  }
});
