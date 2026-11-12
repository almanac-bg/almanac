-- rebuild: runs take duels, and who a duel was against and how it ended. SQLite changes a CHECK only by rebuilding
-- the table; the answers and challenges that point to runs stay (store.go, rebuildMark).
CREATE TABLE runs_new (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('day', 'topic', 'challenge', 'duel')),
  day         TEXT,
  category    TEXT,
  challenge   TEXT,
  -- A duel's: whom it was against (their name; a recording's, with recorded = 1), and how it ended.
  opponent    TEXT,
  recorded    INTEGER NOT NULL DEFAULT 0,
  outcome     TEXT CHECK (outcome IN ('won', 'lost', 'draw')),
  questions   TEXT    NOT NULL,
  at          INTEGER NOT NULL DEFAULT 0,
  shown_at    INTEGER,
  points      INTEGER NOT NULL DEFAULT 0,
  rights      INTEGER NOT NULL DEFAULT 0,
  ms          INTEGER NOT NULL DEFAULT 0,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER
) STRICT;
INSERT INTO runs_new (id, user_id, kind, day, category, challenge, questions, at, shown_at, points, rights, ms, started_at, finished_at)
  SELECT id, user_id, kind, day, category, challenge, questions, at, shown_at, points, rights, ms, started_at, finished_at FROM runs;
DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;
CREATE UNIQUE INDEX runs_one_a_day ON runs (user_id, day) WHERE kind = 'day';
CREATE INDEX runs_board ON runs (day, points DESC, ms) WHERE kind = 'day' AND finished_at IS NOT NULL;
CREATE INDEX runs_user ON runs (user_id, started_at);
CREATE INDEX runs_challenge ON runs (challenge) WHERE challenge IS NOT NULL;
-- Recordings a duel can be played against: finished topic runs and duels.
CREATE INDEX runs_recordings ON runs (finished_at) WHERE kind IN ('topic', 'duel') AND finished_at IS NOT NULL;
