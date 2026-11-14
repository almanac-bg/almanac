-- Progression, made one: achievements and seasons earn XP too, everything unlocked is told once whatever unlocked it,
-- and a division reached is told like a level.

-- An achievement earns its tier's XP (play.AchievementXP); the ones earned before earn theirs now.
ALTER TABLE achievements ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
UPDATE achievements SET xp = CASE
  WHEN id IN ('streak3', 'answers100', 'fast', 'duel1', 'friend1') THEN 50
  WHEN id IN ('streak30', 'answers1000', 'games100', 'master', 'duel10', 'topicPerfect', 'allTypes') THEN 400
  WHEN id IN ('streak100', 'master5', 'duel50') THEN 1000
  ELSE 150 END;

-- A season pays everyone placed in it XP by the division they ended it in (play.Division.XP), told once.
ALTER TABLE season_results ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE season_results ADD COLUMN seen INTEGER NOT NULL DEFAULT 1;

-- All the XP a player has earned, wherever it came from: their games, goals, achievements and seasons.
CREATE VIEW xp_earned AS
  SELECT user_id, xp FROM runs
  UNION ALL SELECT user_id, xp FROM goals_done
  UNION ALL SELECT user_id, xp FROM achievements
  UNION ALL SELECT user_id, xp FROM season_results;

-- What a player has been told is theirs to wear (play.Unlock's key). A player there before starts from what they have
-- (unlocks_known = 0: the first look takes it in without telling); a new one is told of everything, from the first.
CREATE TABLE unlocks_told (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id      TEXT    NOT NULL,
  PRIMARY KEY (user_id, id)
) STRICT, WITHOUT ROWID;
ALTER TABLE users ADD COLUMN unlocks_known INTEGER NOT NULL DEFAULT 1;
UPDATE users SET unlocks_known = 0;

-- The highest rating told: a division reached above it is news.
ALTER TABLE users ADD COLUMN peak_seen INTEGER NOT NULL DEFAULT 1000;
UPDATE users SET peak_seen = peak;
