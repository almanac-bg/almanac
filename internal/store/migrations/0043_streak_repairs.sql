-- A broken streak won back (play/repair.go): the day the player did it, by playing the day's questions and one more
-- game soon after the streak ended; the days missed before it count as kept. `told`: said in a game's news.
CREATE TABLE streak_repairs (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day     TEXT    NOT NULL, -- YYYY-MM-DD, in Bulgaria
  told    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
) STRICT, WITHOUT ROWID;
