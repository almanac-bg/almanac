-- Weekly leagues in place of the rating's monthly seasons (play/leagues.go): every week, everyone who plays races in
-- a group of their league on the XP they earn that week; the first go up a league, the last down. The rating stays
-- what a player's strength is, with no monthly reset. Nothing of a season was ever paid (the first would have ended
-- on 1 December), so the seasons go without a trace.
DROP VIEW xp_earned;

-- The week being played (its Monday, YYYY-MM-DD): one row.
CREATE TABLE league_week (
  id TEXT NOT NULL
) STRICT;

-- A week's groups, each of one league (its tier, 0 the lowest), filled in the order players come.
CREATE TABLE league_groups (
  id   INTEGER PRIMARY KEY,
  week TEXT    NOT NULL,
  tier INTEGER NOT NULL
) STRICT;
CREATE INDEX league_groups_week ON league_groups (week, tier);

CREATE TABLE league_members (
  week      TEXT    NOT NULL,
  user_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  group_id  INTEGER NOT NULL REFERENCES league_groups (id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (week, user_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX league_members_group ON league_members (group_id);

-- How each week ended for each player in it: the league, the place of how many, the week's XP, the move (-1, 0, 1)
-- and the XP the place paid; seen once told.
CREATE TABLE league_results (
  week    TEXT    NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tier    INTEGER NOT NULL,
  place   INTEGER NOT NULL,
  of      INTEGER NOT NULL,
  points  INTEGER NOT NULL,
  moved   INTEGER NOT NULL,
  xp      INTEGER NOT NULL,
  seen    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (week, user_id)
) STRICT;
CREATE INDEX league_results_user ON league_results (user_id, week);

-- The league a player is in now (its tier).
ALTER TABLE users ADD COLUMN league INTEGER NOT NULL DEFAULT 0;

-- The season's podium is gone: its titles and frames come off, its achievement and what was told of them go.
UPDATE users SET title = NULL WHERE title LIKE 'podium%';
UPDATE users SET frame = NULL WHERE frame LIKE 'podium%';
DELETE FROM achievements WHERE id = 'placed';
DELETE FROM unlocks_told WHERE id LIKE '%:podium%';
-- Злато's title was „Златен сезон“: there are no seasons to be golden in now.
UPDATE users SET title = 'goldStandard' WHERE title = 'goldSeason';
UPDATE unlocks_told SET id = 'title:goldStandard:Златен стандарт' WHERE id = 'title:goldSeason:Златен сезон';
DROP TABLE season_results;
DROP TABLE season;
ALTER TABLE users DROP COLUMN season_games;

CREATE VIEW xp_earned AS
  SELECT user_id, xp FROM runs
  UNION ALL SELECT user_id, xp FROM goals_done
  UNION ALL SELECT user_id, xp FROM achievements
  UNION ALL SELECT user_id, xp FROM league_results;
