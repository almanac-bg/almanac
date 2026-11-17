-- Whether a run's news has been told (play.NewsOf with it): Начало tells, once, that of a game that ended without its
-- result on screen (the day's last question let run out, a game left at its end). Every run so far counts as told.
ALTER TABLE runs ADD COLUMN told INTEGER NOT NULL DEFAULT 0;
UPDATE runs SET told = 1;
-- The streak's last notice told on Начало (play.StreakNotice: "kept:<day>" or "ended:<day>"), so that it's told once
-- wherever the player looks, not once on each device.
ALTER TABLE users ADD COLUMN streak_told TEXT NOT NULL DEFAULT '';
