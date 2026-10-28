import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { seasonKey } from '@quiz/shared';
import { config } from './config';
import { guarded } from './guard';
import { nameShape } from './names';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
// WAL + a busy timeout is also what Litestream (continuous backups) needs. synchronous = NORMAL is safe in WAL mode
// (a power cut can lose the last commits, never corrupt the file) and saves an fsync per write.
db.exec(
  'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
);

type Step = string | (() => void);

/**
 * Append-only. Each entry runs once, tracked via PRAGMA user_version.
 *
 * A step counts as breaking unless it's marked compatible(): code from before it can't run on what it leaves (a
 * dropped or renamed column, a value that now means something else), so that code refuses the database — going back
 * to it means restoring the copy from before the migration. A compatible step (a new table, a new column the older code
 * simply doesn't use) lets the release before it run on the database as it is (see schemaFloor), so a rollback is
 * the image alone. Make steps compatible whenever possible; what an older release leaves out meanwhile is filled in
 * by repair() on the next start.
 */
const MIGRATIONS: (Step | { compatible: Step })[] = [
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
      ALTER TABLE users ADD COLUMN freezes INTEGER NOT NULL DEFAULT 0; -- "Леден удар" uses; unused since it went
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

  // v14: notes kept for a player until they've seen them (a challenge link played, a question approved…): a toast
  // reached them only if they were on the page at that moment. The text is written when it happens.
  `
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    icon TEXT NOT NULL,
    text TEXT NOT NULL,
    link TEXT,
    created_at INTEGER NOT NULL,
    read_at INTEGER
  );
  CREATE INDEX notifications_user ON notifications(user_id, id);
  `,

  // v15: how each name looks (names.ts), so a new name can't pass for someone else's with a Cyrillic letter that looks
  // Latin. Not unique: names taken before this may already look alike. Filled in by repair().
  {
    compatible: 'ALTER TABLE users ADD COLUMN username_shape TEXT; CREATE INDEX users_shape ON users(username_shape);',
  },

  // v16: when the session last proved it knows the password (signing in, or confirming it again): what an admin
  // changes needs a recent one. Older code leaves it empty, which only means "confirm again".
  { compatible: 'ALTER TABLE sessions ADD COLUMN confirmed_at INTEGER;' },

  // v17, from the adversarial review:
  // - `won`: the match counted as a win (not one the other side walked out of before it got going). Older code leaves it
  //   empty; repair() fills it in the old way.
  // - `reward_peak`: the season's peak from its 10th game on (SEASON_MIN_GAMES), which the season's reward goes by: a
  //   peak from the first few games, or from the carry-over, isn't a season. Older code leaves it as it was.
  // - `own_set`: the daily run was on questions of its own (a guest's, or an account's made that day), off the board.
  // - `room_xp`: what private-room placements paid that day, against a daily cap.
  // - `answers`: every answer each person gave, kept ANSWER_LOG_DAYS to spot play no person could manage;
  //   `question_stats`: totals per question, kept, for how hard each question really is and which may be wrong.
  {
    compatible: `
    ALTER TABLE match_players ADD COLUMN won INTEGER;
    UPDATE match_players SET won = (placement = 1 AND left_match = 0
      AND (SELECT player_count FROM matches m WHERE m.id = match_id) > 1);
    CREATE INDEX match_players_unsettled ON match_players(match_id) WHERE won IS NULL;
    ALTER TABLE season_ratings ADD COLUMN reward_peak REAL;
    UPDATE season_ratings SET reward_peak = peak WHERE games >= 10;
    ALTER TABLE daily_results ADD COLUMN own_set INTEGER;
    UPDATE daily_results SET own_set = (SELECT is_guest FROM users u WHERE u.id = user_id);
    ALTER TABLE users ADD COLUMN room_xp_day TEXT;
    ALTER TABLE users ADD COLUMN room_xp INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE answers (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      match_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      correct INTEGER NOT NULL,
      time_ms INTEGER,
      answered_at INTEGER NOT NULL
    );
    CREATE INDEX answers_user ON answers(user_id, answered_at);
    CREATE INDEX answers_age ON answers(answered_at);

    CREATE TABLE question_stats (
      question_id TEXT PRIMARY KEY,
      answered INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      correct_ms INTEGER NOT NULL DEFAULT 0
    ) WITHOUT ROWID;
    `,
  },

  // v18, from the full review:
  // - `revealed`: how many of a daily or challenge-link run's questions have been revealed, saved with the score so
  //   far at each reveal. A run a crash cut short is the player's again only if nothing was revealed; otherwise it
  //   ends with the score so far (replaying it would mean knowing answers). Older code leaves it at 0: the old rule.
  // - `challenge_results_board`: a link's board, best first, without reading every run on it.
  {
    compatible: `
    ALTER TABLE daily_results ADD COLUMN revealed INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE challenge_results ADD COLUMN revealed INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX challenge_results_board ON challenge_results(challenge_id, score DESC, time_ms, finished_at)
      WHERE finished_at IS NOT NULL;
    `,
  },

  // v19, one daily for everyone:
  // - `own_set` now only keeps a run off the board (a guest's, an account's made that day): the questions are everyone's.
  // - `daily_links`: a player's link to the day's questions (/daily/<code>), and `via`, whose link a run was opened from.
  //   Older code leaves `via` empty and gives such runs questions of their own again: nothing breaks.
  {
    compatible: `
    CREATE TABLE daily_links (
      code TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) WITHOUT ROWID;
    CREATE UNIQUE INDEX daily_links_user ON daily_links(user_id, day);
    CREATE INDEX daily_links_day ON daily_links(day);
    ALTER TABLE daily_results ADD COLUMN via INTEGER REFERENCES users(id) ON DELETE SET NULL;
    CREATE INDEX daily_results_via ON daily_results(via, day) WHERE via IS NOT NULL;
    `,
  },
];

/** The schema version this code brings a database to. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * The oldest code (by the schema version it knows) that can run on this database: the version the last breaking step
 * brought it to. Kept in `settings`; null on a database from before it was kept (or before `settings` existed).
 */
export function schemaFloor(): number | null {
  const kept = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get()
    ? (db.prepare("SELECT value FROM settings WHERE key = 'schema_floor'").get() as { value: string } | undefined)
    : undefined;
  return kept ? Number(kept.value) : null;
}

function setSchemaFloor(floor: number) {
  if (!db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get()) return;
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('schema_floor', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run(String(floor));
}

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
  // A database from newer code: this is a rollback. Fine while every step since this code's version is compatible;
  // otherwise refuse it (running on it could garble what the newer code wrote).
  if (current > MIGRATIONS.length) {
    const floor = schemaFloor();
    if (floor === null || floor > MIGRATIONS.length) {
      throw new Error(
        `Database is at schema v${current}, but this code only knows v${MIGRATIONS.length}. Use a newer build or another DB_PATH.`,
      );
    }
    console.warn(
      `⏪ Database is at schema v${current}, newer than this code (v${MIGRATIONS.length}): every step since is compatible, so it runs on it.`,
    );
    return;
  }
  if (current > 0 && current < MIGRATIONS.length) copyBeforeMigrating(current);
  // On a database from before the floor was kept, no older code is known to be able to run on it.
  let floor = schemaFloor() ?? current;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const entry = MIGRATIONS[v];
    const compatible = typeof entry === 'object';
    const step = compatible ? entry.compatible : entry;
    if (!compatible) floor = v + 1;
    // The floor goes in with the step: older code must never see this version with a floor from before it.
    tx(() => {
      if (typeof step === 'string') db.exec(step);
      else step();
      db.exec(`PRAGMA user_version = ${v + 1}`);
      setSchemaFloor(floor);
    });
  }
  // A database already up to date, from before the floor was kept.
  if (schemaFloor() === null) setSchemaFloor(floor);
}

/**
 * Fills in what a release from before a compatible step left out while it ran on this database: values this code
 * derives and the older one didn't know to write. Runs at every start; each looks its rows up by index, so it costs
 * nothing when there's nothing to do.
 */
function repair() {
  const unshaped = db.prepare('SELECT id, username FROM users WHERE username_shape IS NULL').all() as {
    id: number;
    username: string;
  }[];
  // Wins older code saved while it ran on this database: counted the old way (the stayer of a no contest included).
  db.exec(`UPDATE match_players SET won = (placement = 1 AND left_match = 0
    AND (SELECT player_count FROM matches m WHERE m.id = match_id) > 1) WHERE won IS NULL`);
  if (!unshaped.length) return;
  const update = db.prepare('UPDATE users SET username_shape = ? WHERE id = ?');
  tx(() => {
    for (const { id, username } of unshaped) update.run(nameShape(username), id);
  });
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
 * Runs `fn` in a transaction. A nested call is a savepoint within it: if it fails, what it wrote (and what it left to
 * run after the commit) is undone, and an outer caller that catches the error still commits its own work — never half
 * of the inner step's.
 */
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return savepoint(fn);
  // IMMEDIATE: the write lock is taken up front, waiting out busy_timeout if Litestream (or the admin command line)
  // holds it. A plain BEGIN that reads first and writes later fails at once instead, with no wait, whenever another
  // connection wrote in between.
  db.exec('BEGIN IMMEDIATE');
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

function savepoint<T>(fn: () => T): T {
  const name = `step${txDepth}`;
  const waiting = onCommit.length;
  db.exec(`SAVEPOINT ${name}`);
  txDepth++;
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    onCommit.length = waiting;
    throw err;
  } finally {
    txDepth--;
  }
}

migrate();
repair();
