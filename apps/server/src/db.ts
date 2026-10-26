import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { seasonKey } from '@quiz/shared';
import { config } from './config';
import { guarded } from './guard';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
// WAL + a busy timeout is also what Litestream (continuous backups) needs. synchronous = NORMAL is safe in WAL mode
// (a power cut can lose the last commits, never corrupt the file) and saves an fsync per write.
db.exec(
  'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
);

/** Append-only. Each entry runs once, tracked via PRAGMA user_version. */
const MIGRATIONS: (string | (() => void))[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    -- Lowercased username: SQLite's NOCASE only folds ASCII, and names may be Cyrillic.
    username_key TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    avatar TEXT NOT NULL DEFAULT 'fox',
    frame TEXT NOT NULL DEFAULT 'classic',
    title TEXT NOT NULL DEFAULT 'rookie',
    last_daily_bonus TEXT,
    games_played INTEGER NOT NULL DEFAULT 0,
    mp_games INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    questions_answered INTEGER NOT NULL DEFAULT 0,
    correct_answers INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    fastest_correct_ms INTEGER,
    total_correct_ms INTEGER NOT NULL DEFAULT 0,
    powerups_used INTEGER NOT NULL DEFAULT 0,
    best_solo_score INTEGER NOT NULL DEFAULT 0,
    hosted_games INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE ratings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    rating REAL NOT NULL,
    games INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, mode)
  );
  CREATE INDEX ratings_board ON ratings(mode, rating DESC);

  CREATE TABLE matches (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    ranked INTEGER NOT NULL,
    room_code TEXT,
    player_count INTEGER NOT NULL,
    question_count INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL
  );

  CREATE TABLE match_players (
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    avatar TEXT NOT NULL,
    is_bot INTEGER NOT NULL,
    placement INTEGER NOT NULL,
    score INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    faced INTEGER NOT NULL,
    best_streak INTEGER NOT NULL,
    eliminated_at INTEGER,
    left_match INTEGER NOT NULL,
    xp_gained INTEGER NOT NULL DEFAULT 0,
    rating_delta REAL,
    PRIMARY KEY (match_id, player_id)
  );
  CREATE INDEX match_players_user ON match_players(user_id);

  CREATE TABLE category_stats (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    answered INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0,
    correct_ms INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, category)
  );

  CREATE TABLE user_achievements (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, achievement_id)
  );
  `,

  // v2: seasons, daily challenge, friends, community questions, teams.
  () => {
    db.exec(`
      ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN daily_streak INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN best_daily_streak INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN last_daily_day TEXT;
      ALTER TABLE users ADD COLUMN freezes INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_players ADD COLUMN team INTEGER;

      CREATE TABLE season_ratings (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        season TEXT NOT NULL,
        mode TEXT NOT NULL,
        rating REAL NOT NULL,
        peak REAL NOT NULL,
        games INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, season, mode)
      );
      CREATE INDEX season_board ON season_ratings(season, mode, rating DESC);

      CREATE TABLE season_rewards (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        season TEXT NOT NULL,
        tier TEXT,
        xp INTEGER NOT NULL,
        unlocks TEXT NOT NULL DEFAULT '[]',
        granted_at INTEGER NOT NULL,
        seen INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, season)
      );

      CREATE TABLE daily_sets (
        day TEXT PRIMARY KEY,
        questions TEXT NOT NULL
      );
      CREATE TABLE daily_results (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        score INTEGER,
        correct INTEGER,
        time_ms INTEGER,
        PRIMARY KEY (user_id, day)
      );
      CREATE INDEX daily_board ON daily_results(day, score DESC);

      CREATE TABLE friendships (
        user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        requested_by INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        accepted_at INTEGER,
        PRIMARY KEY (user_a, user_b),
        CHECK (user_a < user_b)
      );
      CREATE INDEX friendships_b ON friendships(user_b);

      CREATE TABLE questions (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        q TEXT NOT NULL,
        options TEXT NOT NULL,
        answer INTEGER NOT NULL,
        author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE question_submissions (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        q TEXT NOT NULL,
        options TEXT NOT NULL,
        answer INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reason TEXT,
        created_at INTEGER NOT NULL,
        reviewed_at INTEGER,
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        question_id TEXT
      );
      CREATE INDEX submissions_status ON question_submissions(status, created_at);
      CREATE INDEX submissions_user ON question_submissions(user_id);

      UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users);
    `);
    // Ratings so far become the current season's.
    db.prepare(
      `INSERT INTO season_ratings (user_id, season, mode, rating, peak, games, wins)
       SELECT user_id, ?, mode, rating, rating, games, wins FROM ratings`,
    ).run(seasonKey());
    db.exec('DROP TABLE ratings;');
  },

  // v3: email (verified only) for password resets, and single-use email tokens.
  `
  ALTER TABLE users ADD COLUMN email TEXT;
  ALTER TABLE users ADD COLUMN email_key TEXT;
  ALTER TABLE users ADD COLUMN pending_email TEXT;
  CREATE UNIQUE INDEX users_email ON users(email_key) WHERE email_key IS NOT NULL;

  CREATE TABLE email_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,
    email TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE INDEX email_tokens_user ON email_tokens(user_id, purpose);
  `,

  // v4: moderation — bans and player reports.
  `
  ALTER TABLE users ADD COLUMN banned_until INTEGER;
  ALTER TABLE users ADD COLUMN ban_reason TEXT;

  CREATE TABLE reports (
    id INTEGER PRIMARY KEY,
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    details TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT
  );
  CREATE INDEX reports_open ON reports(status, target_id);
  `,

  // v5: players flag mistakes in questions; moderators can hide a question from new matches.
  `
  CREATE TABLE question_reports (
    id INTEGER PRIMARY KEY,
    question_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  -- One open report per player per question.
  CREATE UNIQUE INDEX question_reports_once ON question_reports(question_id, user_id) WHERE status = 'open';
  CREATE INDEX question_reports_open ON question_reports(status, question_id);

  CREATE TABLE hidden_questions (
    question_id TEXT PRIMARY KEY,
    hidden_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    hidden_at INTEGER NOT NULL
  );
  `,

  // v6: which questions each player saw recently survives restarts (it lived in memory, unbounded); indexes for
  // queries that scanned whole tables: the level leaderboard, expired-session cleanup, approved questions per author.
  `
  CREATE TABLE seen_questions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    seen_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, question_id)
  ) WITHOUT ROWID;
  CREATE INDEX seen_questions_recent ON seen_questions(user_id, seen_at);

  CREATE INDEX users_xp ON users(xp DESC, id);
  CREATE INDEX sessions_expiry ON sessions(expires_at);
  CREATE INDEX questions_author ON questions(author_id);
  `,

  // v7: session tokens are stored as SHA-256 hashes (a leaked database or backup holds no usable logins).
  () => {
    const rows = db.prepare('SELECT token FROM sessions').all() as { token: string }[];
    const update = db.prepare('UPDATE sessions SET token = ? WHERE token = ?');
    for (const { token } of rows) update.run(createHash('sha256').update(token).digest('base64url'), token);
  },

  // v8: guest accounts (play first, sign up later), streak shields and opt-in streak reminders, daily quests,
  // and challenge links (a fixed set of questions anyone with the link can play once).
  `
  ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN streak_shields INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN streak_reminders INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN reminder_key TEXT;
  ALTER TABLE users ADD COLUMN reminded_day TEXT;
  CREATE INDEX users_guests ON users(created_at) WHERE is_guest = 1;
  CREATE INDEX users_reminders ON users(last_daily_day) WHERE streak_reminders = 1;

  CREATE TABLE quest_progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    quest TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    done_at INTEGER,
    PRIMARY KEY (user_id, day, quest)
  ) WITHOUT ROWID;
  CREATE INDEX quest_progress_day ON quest_progress(day);

  CREATE TABLE challenges (
    id TEXT PRIMARY KEY,
    creator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    questions TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX challenges_creator ON challenges(creator_id, created_at);
  CREATE INDEX challenges_expiry ON challenges(expires_at);

  CREATE TABLE challenge_results (
    challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    score INTEGER,
    correct INTEGER,
    time_ms INTEGER,
    PRIMARY KEY (challenge_id, user_id)
  );
  CREATE INDEX challenge_results_user ON challenge_results(user_id, started_at);
  `,

  // v9: launch statistics, counted as things happen (Sofia days), so they survive guest clean-up and need no tracking.
  `
  CREATE TABLE daily_stats (
    day TEXT NOT NULL,
    metric TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, metric)
  ) WITHOUT ROWID;
  `,

  // v10: values this installation generates once and keeps (e.g. the secret in the daily challenge's seed).
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) WITHOUT ROWID;
  `,

  // v11: when each account was last used, so accounts unused for years can be deleted (the privacy policy's limit).
  // Until then, the latest session's start (sessions last 30 days) or the sign-up.
  `
  ALTER TABLE users ADD COLUMN last_seen_at INTEGER;
  ALTER TABLE users ADD COLUMN inactivity_warned_at INTEGER;
  UPDATE users SET last_seen_at = MAX(created_at, COALESCE(
    (SELECT MAX(expires_at) - 2592000000 FROM sessions WHERE sessions.user_id = users.id), 0));
  CREATE INDEX users_last_seen ON users(last_seen_at) WHERE is_guest = 0;
  `,

  // v12: when our mail provider last reported the verified address as undeliverable (bounce, spam complaint).
  `
  ALTER TABLE users ADD COLUMN email_bounced_at INTEGER;
  `,

  // v13: every account has a last-seen time (a session always sets it), so retiring unused accounts can use its index.
  `
  UPDATE users SET last_seen_at = created_at WHERE last_seen_at IS NULL;
  `,
];

/** The schema version this code brings a database to. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * A copy of the database as it was before this code's migrations (into the backups folder): migrations only go
 * forward, so this is the way back to the previous version should a deploy go wrong. Taken once per schema version —
 * a crash-looping deploy doesn't fill the disk with copies.
 */
function copyBeforeMigrating(from: number) {
  if (!config.backupDir) return;
  const file = path.join(config.backupDir, `quiz-v${from}-before-v${MIGRATIONS.length}.db`);
  if (fs.existsSync(file)) return;
  fs.mkdirSync(config.backupDir, { recursive: true });
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  console.log(`💾 Saved the database before migrating (v${from} → v${MIGRATIONS.length}): ${file}`);
}

function migrate() {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  // A database from newer code would silently skip this code's future migrations — refuse it instead.
  if (current > MIGRATIONS.length) {
    throw new Error(
      `Database is at schema v${current}, but this code only knows v${MIGRATIONS.length}. Use a newer build or another DB_PATH.`,
    );
  }
  if (current > 0 && current < MIGRATIONS.length) copyBeforeMigrating(current);
  for (let v = current; v < MIGRATIONS.length; v++) {
    tx(() => {
      const step = MIGRATIONS[v];
      if (typeof step === 'string') db.exec(step);
      else step();
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

const statements = new Map<string, ReturnType<DatabaseSync['prepare']>>();
function stmt(sql: string) {
  let s = statements.get(sql);
  if (!s) {
    s = db.prepare(sql);
    statements.set(sql, s);
  }
  return s;
}

export function one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return stmt(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return stmt(sql).all(...params) as T[];
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return stmt(sql).run(...params);
}

/** A UNIQUE constraint said no: e.g. two sign-ups for the same name at once, both past the "is it free?" check. */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { errcode?: unknown } | null)?.errcode === 2067; // SQLITE_CONSTRAINT_UNIQUE
}

let txDepth = 0;
/** What waits for the outermost transaction to commit; dropped if it rolls back. */
let onCommit: (() => void)[] = [];

/**
 * Runs `fn` once what's being written is in for good: at once outside a transaction, after the COMMIT inside one. For
 * telling people (a notice, a live update): nobody should hear about a result that was then rolled back.
 */
export function afterCommit(fn: () => void) {
  if (txDepth === 0) fn();
  else onCommit.push(fn);
}

/**
 * Runs `fn` in a transaction. Nested calls join the outer transaction, so an inner failure that an outer caller catches
 * still commits the outer work done so far.
 */
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  db.exec('BEGIN');
  txDepth++;
  let committed = false;
  try {
    const result = fn();
    db.exec('COMMIT');
    committed = true;
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth--;
    const waiting = onCommit;
    onCommit = [];
    // The data is in either way: a failing notice must not read to the caller as a failed write.
    if (committed) for (const run of waiting) guarded('after a commit', run)();
  }
}

migrate();
