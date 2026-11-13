-- XP: what a player earns by playing, apart from a game's points (play/worth.go). Each run keeps what it earned; a
-- player's level is the sum. Runs played before are given theirs from their answers: 10 for each answer given and 10
-- more times its score, 50 for a game played to its end and 50 more for the day's.
ALTER TABLE runs ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
UPDATE runs SET xp =
  coalesce((SELECT sum(10 + CAST(round(10 * score) AS INTEGER)) FROM answers WHERE run_id = runs.id AND given IS NOT NULL), 0)
  + CASE WHEN finished_at IS NULL THEN 0 WHEN kind = 'day' THEN 100 ELSE 50 END;
CREATE INDEX runs_finished ON runs (finished_at, user_id) WHERE finished_at IS NOT NULL;
-- The daily goal for points is one for XP now.
UPDATE goals_done SET goal = 'xp400' WHERE goal = 'points500';
-- Levels are XP's now (300 for the first, 150 more for each after: play.LevelOf): the level last told is the one
-- each player is at, so that the change itself is no level-up.
WITH RECURSIVE levels (level, start) AS (
  SELECT 1, 0 UNION ALL SELECT level + 1, start + 300 + 150 * (level - 1) FROM levels WHERE level < 1000
)
UPDATE users SET level_seen = (SELECT max(level) FROM levels
  WHERE start <= (SELECT coalesce(sum(xp), 0) FROM runs WHERE user_id = users.id));
