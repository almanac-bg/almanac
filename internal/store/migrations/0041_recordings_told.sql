-- When a player last heard how others' duels against their recordings went (play.RecordingsNews): once a day.
ALTER TABLE users ADD COLUMN recordings_told INTEGER NOT NULL DEFAULT 0;
-- The duels played against a player's recordings, found from their runs.
CREATE INDEX duels_ghost_run ON duels (ghost_run) WHERE ghost_run IS NOT NULL;
