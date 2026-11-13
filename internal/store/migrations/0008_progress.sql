-- Progress: achievements a player has earned, and how they look to others (an avatar, a title chosen from what
-- they've earned). The level is worked out from the points in their runs, so it isn't kept; only the last one
-- announced to them is.
CREATE TABLE achievements (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id      TEXT    NOT NULL, -- play.Achievements
  at      INTEGER NOT NULL,
  seen    INTEGER NOT NULL DEFAULT 0, -- announced to the player yet
  PRIMARY KEY (user_id, id)
) STRICT, WITHOUT ROWID;

ALTER TABLE users ADD COLUMN avatar TEXT; -- shape-tone (play.Shapes, play.Tones); NULL: the one the game gives them
ALTER TABLE users ADD COLUMN title TEXT;  -- an achievement of theirs, shown by its name; NULL: none
ALTER TABLE users ADD COLUMN level_seen INTEGER NOT NULL DEFAULT 1;
