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

  // v20, foundations for opponents from recorded play and for measured difficulty:
  // - `runs`: each person's finished match, question by question (runs.ts), kept RUN_KEEP_DAYS.
  // - `question_skill`, `player_skill`: how hard each question is and how strong each player is (overall and per
  //   category), on one scale, moved by every answer (skill.ts). Older code leaves all three alone.
  {
    compatible: `
    CREATE TABLE runs (
      id INTEGER PRIMARY KEY,
      match_id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      category TEXT NOT NULL,
      rating REAL,
      score INTEGER NOT NULL,
      correct INTEGER NOT NULL,
      answers TEXT NOT NULL,
      played_at INTEGER NOT NULL
    );
    CREATE INDEX runs_user ON runs(user_id, played_at);
    CREATE INDEX runs_mode ON runs(mode, played_at);

    CREATE TABLE question_skill (
      question_id TEXT PRIMARY KEY,
      rating REAL NOT NULL,
      answers INTEGER NOT NULL DEFAULT 0
    ) WITHOUT ROWID;
    CREATE TABLE player_skill (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      rating REAL NOT NULL,
      answers INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, category)
    ) WITHOUT ROWID;
    `,
  },

  // v21, opponents any time:
  // - `users.share_runs`: whether others may play against this player's recorded matches (records.ts; Settings).
  // - `record_plays`: each match played against a recording, for its owner's note the next day.
  // - `challenges.rival_id`: a friend duel — a challenge for one friend, who has a day to play it — and
  //   `expired_told`, set once its creator has heard it ran out unplayed. Older code leaves them all alone.
  {
    compatible: `
    ALTER TABLE users ADD COLUMN share_runs INTEGER NOT NULL DEFAULT 1;

    CREATE TABLE record_plays (
      id INTEGER PRIMARY KEY,
      run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      player_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      record_won INTEGER NOT NULL,
      played_at INTEGER NOT NULL,
      told INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX record_plays_owner ON record_plays(owner_id, played_at);
    CREATE INDEX record_plays_untold ON record_plays(played_at) WHERE told = 0;

    ALTER TABLE challenges ADD COLUMN rival_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
    ALTER TABLE challenges ADD COLUMN expired_told INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX challenges_rival ON challenges(rival_id, created_at) WHERE rival_id IS NOT NULL;
    CREATE INDEX challenges_duels_open ON challenges(expires_at) WHERE rival_id IS NOT NULL AND expired_told = 0;
    `,
  },

  // v22, progress:
  // - `learned`: „Моят алманах“ — each question a player got right, or stopped on to read its fact (almanac.ts).
  // - `review_queue`: „Поправителен“ — each missed question and when it comes back (REVIEW).
  // - `question_stats.pick0`…`pick3`, `unanswered`: how many picked each option (as the bank orders them), or none in
  //   time: „X% знаят“ and the review's shares. Filled from the recorded runs so far (runs keep each pick; a number
  //   question's carry its number, `g`, and stay out). Older code doesn't count them: the shares are of what's counted.
  // - `mastery`: the category mastery tier each player earned (mastery.ts); `player_skill_ranked`, the skill of those
  //   ranked in each category, to find its tiers' cut-offs.
  // - `player_groups`, `group_members`, `group_weeks` (each finished week's winner): groups (groups.ts).
  // Older code leaves them all alone.
  {
    compatible: `
    CREATE TABLE learned (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL,
      learned_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, question_id)
    ) WITHOUT ROWID;
    CREATE INDEX learned_recent ON learned(user_id, learned_at);

    CREATE TABLE review_queue (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL,
      step INTEGER NOT NULL,
      due_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, question_id)
    ) WITHOUT ROWID;
    CREATE INDEX review_due ON review_queue(user_id, due_at);

    ALTER TABLE question_stats ADD COLUMN pick0 INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE question_stats ADD COLUMN pick1 INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE question_stats ADD COLUMN pick2 INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE question_stats ADD COLUMN pick3 INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE question_stats ADD COLUMN unanswered INTEGER NOT NULL DEFAULT 0;
    INSERT INTO question_stats (question_id, pick0, pick1, pick2, pick3, unanswered)
      SELECT json_extract(a.value, '$.q') AS question_id,
        SUM(json_extract(a.value, '$.c') IS 0), SUM(json_extract(a.value, '$.c') IS 1),
        SUM(json_extract(a.value, '$.c') IS 2), SUM(json_extract(a.value, '$.c') IS 3),
        SUM(json_extract(a.value, '$.c') IS NULL)
      FROM runs, json_each(runs.answers) AS a
      WHERE json_type(a.value, '$.g') IS NULL
      GROUP BY question_id
    ON CONFLICT (question_id) DO UPDATE SET pick0 = excluded.pick0, pick1 = excluded.pick1, pick2 = excluded.pick2,
      pick3 = excluded.pick3, unanswered = excluded.unanswered;

    CREATE TABLE mastery (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      tier INTEGER NOT NULL,
      earned_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, category)
    ) WITHOUT ROWID;
    CREATE INDEX player_skill_ranked ON player_skill(category, rating) WHERE answers >= 30;

    CREATE TABLE player_groups (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE group_members (
      group_id INTEGER NOT NULL REFERENCES player_groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (group_id, user_id)
    ) WITHOUT ROWID;
    CREATE INDEX group_members_user ON group_members(user_id);
    CREATE TABLE group_weeks (
      group_id INTEGER NOT NULL REFERENCES player_groups(id) ON DELETE CASCADE,
      week TEXT NOT NULL,
      winner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      score INTEGER NOT NULL,
      PRIMARY KEY (group_id, week)
    ) WITHOUT ROWID;
    `,
  },

  // v23, rooms and the evening:
  // - `question_sets`: a host's own questions for their rooms („Моите въпроси“, sets.ts), shared by `code`; `hidden`
  //   by a moderator after a report.
  // - `evening_results`: each person's place in the evening Роял (evening.ts), for the night's top ten, the
  //   champion's title and the frame for three wins. Older code leaves both alone.
  {
    compatible: `
    CREATE TABLE question_sets (
      id INTEGER PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      questions TEXT NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0,
      copied_from INTEGER REFERENCES question_sets(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX question_sets_owner ON question_sets(owner_id, updated_at);

    CREATE TABLE evening_results (
      day TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      placement INTEGER NOT NULL,
      score INTEGER NOT NULL,
      players INTEGER NOT NULL,
      PRIMARY KEY (day, user_id)
    ) WITHOUT ROWID;
    CREATE INDEX evening_wins ON evening_results(user_id) WHERE placement = 1;
    `,
  },

  // v24, pictures in a host's own sets: `set_images` keeps each picture its uploader put in a question (sets.ts), by
  // the hash of its content (`id`), until no set uses it; `blocked` by a moderator who hid a set it's in. Its uploader
  // gone, it goes too, from copies of their sets as well. Older code leaves it alone.
  {
    compatible: `
    CREATE TABLE set_images (
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      type TEXT NOT NULL,
      bytes BLOB NOT NULL,
      w INTEGER NOT NULL,
      h INTEGER NOT NULL,
      blocked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, id)
    );
    CREATE INDEX set_images_id ON set_images(id);
    `,
  },

  // v25, moderation (modlog.ts): `moderation_log` keeps every moderator's (or the game's own) decision, its basis and
  // reason, and what it takes to undo it; a ban keeps its basis (`users.ban_basis`). A question proposed by a player
  // carries the source of its answer, and may carry a fact with its source — kept with the question once approved.
  // Older code leaves them alone.
  {
    compatible: `
    CREATE TABLE moderation_log (
      id INTEGER PRIMARY KEY,
      admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      target TEXT,
      basis TEXT,
      reason TEXT,
      undo TEXT,
      created_at INTEGER NOT NULL,
      undone_at INTEGER,
      undone_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX moderation_log_time ON moderation_log(created_at);
    CREATE INDEX moderation_log_user ON moderation_log(target_user_id, created_at);

    ALTER TABLE users ADD COLUMN ban_basis TEXT;
    ALTER TABLE question_submissions ADD COLUMN answer_source TEXT;
    ALTER TABLE question_submissions ADD COLUMN fact TEXT;
    ALTER TABLE question_submissions ADD COLUMN fact_source TEXT;
    ALTER TABLE questions ADD COLUMN answer_source TEXT;
    ALTER TABLE questions ADD COLUMN fact TEXT;
    ALTER TABLE questions ADD COLUMN fact_source TEXT;
    `,
  },

  // v26, reaching players (6c). `blocks`: who blocked whom (no friend requests either way). `beaten_mails`: the opt-in
  // „X те изпревари на линка ти“ email, at most one a day (`beaten_mail_day`). Web push (push.ts): each device's
  // subscription, what the player wants pushed (`push_prefs`, JSON), and what went out each day (`push_sent`, for the
  // two-a-day cap and one of each kind). Older code leaves them alone.
  {
    compatible: `
    CREATE TABLE blocks (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, blocked_id)
    ) WITHOUT ROWID;
    CREATE INDEX blocks_blocked ON blocks(blocked_id);

    ALTER TABLE users ADD COLUMN beaten_mails INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN beaten_mail_day TEXT;

    CREATE TABLE push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) WITHOUT ROWID;
    CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
    ALTER TABLE users ADD COLUMN push_prefs TEXT;
    CREATE TABLE push_sent (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      day TEXT NOT NULL,
      PRIMARY KEY (user_id, kind)
    ) WITHOUT ROWID;
    `,
  },

  // v27, long history (6e; test/plans.ts found each of these by asking SQLite how it runs every statement):
  // - an index on every column pointing at a player, so deleting an account (a guest swept every day) finds the rows
  //   to clear by index instead of reading eleven tables; the same for a run's plays of its recording;
  // - indexes for what the upkeep looks for every 15 minutes, and for the moderators' lists; the level board's
  //   index holds accounts only (a guest is never on it), and the recordings' untold plays are kept by owner;
  // - running tallies: `mode_stats` (games, wins and places per player and mode, for profiles and achievements, which
  //   counted them from every match the player ever played) and `answer_tallies` (the hard answers of the last
  //   ANSWER_LOG_DAYS per player, for the moderators' flag list, which grouped the whole answer log), with
  //   `settings.tallied_at` saying how far they go (see catchUpTallies);
  // - `users.settled`: the season and achievement list the player's account was last settled for, so /me settles only
  //   when one of them changed (it did so on every call, in a write transaction);
  // - `users.freezes` goes: unused since "Леден удар" went, and no release that can run on this database reads it.
  // The tallies are filled at the first start (tallies.ts). Older code leaves them alone; what it plays meanwhile is
  // counted at the next start.
  {
    compatible: `
    CREATE INDEX reports_target ON reports(target_id);
    CREATE INDEX reports_reporter ON reports(reporter_id) WHERE reporter_id IS NOT NULL;
    CREATE INDEX reports_resolver ON reports(resolved_by) WHERE resolved_by IS NOT NULL;
    CREATE INDEX question_reports_user ON question_reports(user_id);
    CREATE INDEX question_reports_resolver ON question_reports(resolved_by) WHERE resolved_by IS NOT NULL;
    CREATE INDEX question_reports_recent ON question_reports(question_id, created_at);
    CREATE INDEX hidden_questions_by ON hidden_questions(hidden_by) WHERE hidden_by IS NOT NULL;
    CREATE INDEX submissions_reviewer ON question_submissions(reviewed_by) WHERE reviewed_by IS NOT NULL;
    CREATE INDEX record_plays_run ON record_plays(run_id);
    CREATE INDEX record_plays_player ON record_plays(player_id) WHERE player_id IS NOT NULL;
    CREATE INDEX record_plays_age ON record_plays(played_at);
    DROP INDEX record_plays_untold;
    CREATE INDEX record_plays_untold ON record_plays(owner_id, played_at) WHERE told = 0;
    CREATE INDEX player_groups_owner ON player_groups(owner_id) WHERE owner_id IS NOT NULL;
    CREATE INDEX group_weeks_winner ON group_weeks(winner_id) WHERE winner_id IS NOT NULL;
    CREATE INDEX question_sets_copied ON question_sets(copied_from) WHERE copied_from IS NOT NULL;
    CREATE INDEX evening_results_user ON evening_results(user_id, placement);
    DROP INDEX evening_wins;
    CREATE INDEX moderation_log_admin ON moderation_log(admin_id) WHERE admin_id IS NOT NULL;
    CREATE INDEX moderation_log_undoer ON moderation_log(undone_by) WHERE undone_by IS NOT NULL;

    CREATE INDEX email_tokens_expiry ON email_tokens(expires_at);
    CREATE INDEX email_tokens_used ON email_tokens(used_at) WHERE used_at IS NOT NULL;
    CREATE INDEX notifications_age ON notifications(created_at);
    CREATE INDEX runs_age ON runs(played_at);
    CREATE INDEX set_images_age ON set_images(created_at);
    CREATE INDEX matches_ended ON matches(ended_at);
    CREATE INDEX users_pending_email ON users(id) WHERE pending_email IS NOT NULL;
    CREATE INDEX users_champion ON users(id) WHERE title = 'evening_champion';
    CREATE INDEX users_push ON users(id) WHERE push_prefs IS NOT NULL;
    CREATE INDEX users_admins ON users(username) WHERE is_admin = 1;
    DROP INDEX users_xp;
    CREATE INDEX users_board ON users(xp DESC, id) WHERE is_guest = 0;

    CREATE TABLE mode_stats (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      games INTEGER NOT NULL,
      firsts INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      team_wins INTEGER NOT NULL,
      placed INTEGER NOT NULL,
      placements INTEGER NOT NULL,
      PRIMARY KEY (user_id, mode)
    ) WITHOUT ROWID;
    CREATE TABLE answer_tallies (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      answered INTEGER NOT NULL,
      correct INTEGER NOT NULL,
      last_at INTEGER NOT NULL
    );

    ALTER TABLE users ADD COLUMN settled TEXT;
    ALTER TABLE users DROP COLUMN freezes;
    `,
  },
  // v28, review fixes: an undo looks for a later decision about the same question, set or group (modlog.ts →
  // laterDecision), by what it was about.
  {
    compatible: `
    CREATE INDEX moderation_log_target ON moderation_log(target, id) WHERE target IS NOT NULL;
    `,
  },
  // v29, a class keeps nothing: `room_guest_seen_at` marks a guest made to join a room from its link (a pupil), and
  // holds when it was last here; an hour after that it's erased with all it played (guests.ts → purgeRoomGuests).
  {
    compatible: `
    ALTER TABLE users ADD COLUMN room_guest_seen_at INTEGER;
    CREATE INDEX users_room_guests ON users(room_guest_seen_at) WHERE room_guest_seen_at IS NOT NULL;
    `,
  },
  // v30, moderation by case (moderation.ts): a report says what it's about — a player (`target_id`), a group or a set
  // (`subject_id`: its id or code; `target_id` is then its owner) — and the open ones about one thing are one case.
  // Open reports from before, about a group or a set, are read from the text they carried. An undo keeps its reason; a
  // group a moderator renamed keeps the name for a while (`name_locked_until`).
  {
    compatible: `
    ALTER TABLE reports ADD COLUMN subject_kind TEXT NOT NULL DEFAULT 'player';
    ALTER TABLE reports ADD COLUMN subject_id TEXT;
    UPDATE reports SET subject_kind = 'set',
      subject_id = substr(details, instr(details, '(/sets/shared/') + 14,
        instr(substr(details, instr(details, '(/sets/shared/') + 14), ')') - 1)
    WHERE status = 'open' AND details LIKE 'Набор „%' AND instr(details, '(/sets/shared/') > 0;
    UPDATE reports SET subject_kind = 'group',
      subject_id = substr(details, instr(details, '(№') + 2, instr(substr(details, instr(details, '(№') + 2), ')') - 1)
    WHERE status = 'open' AND details LIKE 'Група „%' AND instr(details, '(№') > 0;
    CREATE INDEX reports_subject ON reports(subject_kind, subject_id, status);
    ALTER TABLE moderation_log ADD COLUMN undo_reason TEXT;
    ALTER TABLE player_groups ADD COLUMN name_locked_until INTEGER;
    `,
  },
  // v31, staff (moderation.ts, totp.ts): `staff_role` — the owner (who runs the place: decides about moderators, reloads
  // the bank) or a moderator; `is_admin` stays the mark of either. Admins until now were made by the owner and become
  // the owner. A one-time code from an authenticator app (`totp_*`) for /admin, kept per session
  // (`second_factor_at`).
  {
    compatible: `
    ALTER TABLE users ADD COLUMN staff_role TEXT;
    UPDATE users SET staff_role = 'owner' WHERE is_admin = 1;
    ALTER TABLE users ADD COLUMN totp_secret TEXT;
    ALTER TABLE users ADD COLUMN totp_on_at INTEGER;
    ALTER TABLE users ADD COLUMN totp_step INTEGER;
    ALTER TABLE sessions ADD COLUMN second_factor_at INTEGER;
    `,
  },
  // v32, set pictures (sets.ts): a picture a moderator blocked, by its content's hash — whoever uploads it again, and
  // whichever copy of a set has it, it's neither taken nor served (a blocked picture used to come back on re-upload).
  // Pictures blocked until now are blocked for good the same way. Hidden sets, found by index.
  {
    compatible: `
    CREATE TABLE blocked_pictures (
      id TEXT PRIMARY KEY,
      blocked_at INTEGER NOT NULL
    ) WITHOUT ROWID;
    INSERT OR IGNORE INTO blocked_pictures (id, blocked_at) SELECT id, created_at FROM set_images WHERE blocked = 1;
    CREATE INDEX question_sets_hidden ON question_sets(id) WHERE hidden = 1;
    `,
  },
  // v33, privacy: a recording's row in someone's match keeps its owner (`record_owner_id`), so deleting the account
  // takes the name out of other players' histories too (it stayed there, under no account); filled in for every
  // recording whose run is still there. When a player turned the opt-in mails on, and when they accepted the terms
  // (`*_on_at`, `terms_at`): consent that can be shown. A banned account deleted leaves only a keyed hash of its e-mail
  // and the ban, for 12 months (`erased_bans`, account.ts): starting over with the same address shows on the new card.
  {
    compatible: `
    ALTER TABLE match_players ADD COLUMN record_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    UPDATE match_players SET record_owner_id = (SELECT r.user_id FROM runs r WHERE 'r' || r.id = match_players.player_id)
    WHERE user_id IS NULL AND player_id LIKE 'r%';
    CREATE INDEX match_players_record_owner ON match_players(record_owner_id) WHERE record_owner_id IS NOT NULL;
    ALTER TABLE users ADD COLUMN reminders_on_at INTEGER;
    ALTER TABLE users ADD COLUMN beaten_mails_on_at INTEGER;
    ALTER TABLE users ADD COLUMN terms_at INTEGER;
    CREATE TABLE erased_bans (
      email_hash TEXT PRIMARY KEY,
      basis TEXT,
      banned_until INTEGER,
      erased_at INTEGER NOT NULL
    ) WITHOUT ROWID;
    CREATE INDEX erased_bans_age ON erased_bans(erased_at);
    `,
  },
  // v34, abuse (challenges.ts → payDuelWin): friend-duel wins that paid XP today, so a second account that always loses
  // can't feed the first one's level.
  {
    compatible: `
    ALTER TABLE users ADD COLUMN duel_win_day TEXT;
    ALTER TABLE users ADD COLUMN duel_wins_paid INTEGER NOT NULL DEFAULT 0;
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

/**
 * Tests only: each statement the process prepares is written once to this folder, and test/plans.ts then asks SQLite
 * how it would run every one of them (an unindexed read of a table that grows fails the suite).
 */
const sqlLog = process.env.SQL_LOG ? path.join(process.env.SQL_LOG, `${process.pid}.jsonl`) : null;
if (sqlLog) fs.mkdirSync(path.dirname(sqlLog), { recursive: true });

const statements = new Map<string, ReturnType<DatabaseSync['prepare']>>();
function stmt(sql: string) {
  let s = statements.get(sql);
  if (!s) {
    s = db.prepare(sql);
    statements.set(sql, s);
    // The server's own statements, not a test's fixtures written through these helpers.
    if (sqlLog && !new Error().stack?.split('\n')[3]?.includes(`${path.sep}test${path.sep}`))
      fs.appendFileSync(sqlLog, `${JSON.stringify(sql)}\n`);
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

/** Another connection held the write lock for longer than busy_timeout (SQLITE_BUSY and its extended codes). */
export function isBusy(err: unknown): boolean {
  const code = (err as { errcode?: unknown } | null)?.errcode;
  return typeof code === 'number' && (code & 0xff) === 5;
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
optimize(true);

/**
 * Keeps SQLite's picture of the tables (sqlite_stat1) up to date, so it picks the right index as they grow: at the start
 * (0x10002: every table, as a long-lived connection should) and with the upkeep after. Each table is sampled, never
 * read whole (analysis_limit), so it takes milliseconds however big the database.
 */
export function optimize(atStart = false) {
  db.exec(`PRAGMA analysis_limit = 400; PRAGMA optimize${atStart ? ' = 0x10002' : ''};`);
}
