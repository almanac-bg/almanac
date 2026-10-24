import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { seasonKey } from '@quiz/shared';
import { config } from './config';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

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
];

function migrate() {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  // A database from newer code would silently skip this code's future migrations — refuse it instead.
  if (current > MIGRATIONS.length) {
    throw new Error(`Database is at schema v${current}, but this code only knows v${MIGRATIONS.length}. Use a newer build or another DB_PATH.`);
  }
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

let txDepth = 0;

/** Runs `fn` in a transaction. Nested calls join the outer transaction. */
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  db.exec('BEGIN');
  txDepth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth--;
  }
}

migrate();
