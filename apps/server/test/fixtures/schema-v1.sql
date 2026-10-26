-- Schema v1 exactly as the first migration created it (apps/server/src/db.ts, MIGRATIONS[0]), frozen here: migrations
-- are never edited, so this stays what a real database of that age looks like. Used by migrations.test.ts.

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

-- Two players, one signed in, from before any later migration: what the first release left on disk.
INSERT INTO users (id, username, username_key, password_hash, created_at, xp, games_played, mp_games, wins)
VALUES (1, 'Ана', 'ана', 'scrypt$legacy$salt$hash', 1760000000000, 420, 3, 3, 2),
     (2, 'boris', 'boris', 'scrypt$legacy$salt$hash', 1760500000000, 0, 0, 0, 0);
INSERT INTO sessions (token, user_id, created_at, expires_at)
VALUES ('raw-session-token-of-ana', 1, 1761000000000, 1763592000000);
INSERT INTO ratings (user_id, mode, rating, games, wins) VALUES (1, 'duel', 1084.5, 3, 2);
INSERT INTO matches (id, mode, ranked, room_code, player_count, question_count, started_at, ended_at)
VALUES ('m1', 'duel', 1, NULL, 2, 10, 1761000100000, 1761000400000);
INSERT INTO match_players (match_id, player_id, user_id, name, avatar, is_bot, placement, score, correct, faced,
best_streak, eliminated_at, left_match, xp_gained, rating_delta)
VALUES ('m1', 'u1', 1, 'Ана', 'fox', 0, 1, 7200, 8, 10, 5, NULL, 0, 140, 16.2),
     ('m1', 'b1', NULL, 'Бот', 'owl', 1, 2, 3100, 4, 10, 2, NULL, 0, 0, NULL);
INSERT INTO category_stats (user_id, category, answered, correct, correct_ms) VALUES (1, 'history', 10, 8, 41000);
INSERT INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (1, 'first_win', 1761000400000);

PRAGMA user_version = 1;
