-- The parts of the game a player opened this week that are only looked at (play.Used: the book, Приятели, the seal),
-- a bit each, and the week, its Monday: only so that /admin counts, without a name, how many players use each.
ALTER TABLE users ADD COLUMN used_week TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN used INTEGER NOT NULL DEFAULT 0;
