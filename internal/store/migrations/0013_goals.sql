-- Daily goals done: each a star for the season (a calendar month in Bulgaria). Kept as they're done, so that a
-- season's stars are a count.
CREATE TABLE goals_done (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day     TEXT    NOT NULL, -- YYYY-MM-DD, in Bulgaria
  goal    TEXT    NOT NULL, -- play.Goals
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, day, goal)
) STRICT, WITHOUT ROWID;
CREATE INDEX goals_done_day ON goals_done (day);
