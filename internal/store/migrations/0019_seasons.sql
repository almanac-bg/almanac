-- Seasons are the rating's now: a calendar month in Bulgaria. When one ends, everyone with enough rated games in it
-- is placed by rating (the first is its champion), and every rating goes halfway back to the start. The day's goals
-- earn XP instead of stars.

-- A goal done earns XP (play.GoalXP), told once like a level; the ones done before earned theirs then.
ALTER TABLE goals_done ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE goals_done ADD COLUMN seen INTEGER NOT NULL DEFAULT 1; -- told to the player yet
UPDATE goals_done SET xp = 100;

-- The season being played (one row, written by the game when it starts one), and the rated games each player has
-- played in it: every rating so far came this month, the first season.
CREATE TABLE season (id TEXT NOT NULL) STRICT; -- YYYY-MM
ALTER TABLE users ADD COLUMN season_games INTEGER NOT NULL DEFAULT 0;
UPDATE users SET season_games = rated;

-- How each season ended for those placed in it.
CREATE TABLE season_results (
  season  TEXT    NOT NULL, -- YYYY-MM
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  place   INTEGER NOT NULL, -- 1: the champion
  rating  INTEGER NOT NULL, -- at the season's end, before it was softened
  games   INTEGER NOT NULL, -- rated games played in it
  PRIMARY KEY (season, user_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX season_results_user ON season_results (user_id, season);

-- The monthly star frames are gone: whoever wore one wears none.
UPDATE users SET frame = NULL WHERE frame LIKE 'season-%';
