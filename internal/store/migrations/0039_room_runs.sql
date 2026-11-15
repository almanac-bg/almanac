-- rebuild: runs take a room's games too (kind 'room': each player's game in a room, kept as it ends; play rooms.go).
-- SQLite changes a CHECK only by rebuilding; what points to runs stays (store.go). The indexes are made again as
-- they are now (runs_board as 0037 left it).
CREATE TABLE runs_new (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('day', 'topic', 'challenge', 'duel', 'royal', 'mistakes', 'room')),
  day         TEXT,
  category    TEXT,
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
  finished_at INTEGER,
  opponent_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  xp          INTEGER NOT NULL DEFAULT 0,
  scripted    INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO runs_new (id, user_id, kind, day, category, opponent, recorded, outcome, questions, at, shown_at, points,
    rights, ms, started_at, finished_at, opponent_id, xp, scripted)
  SELECT id, user_id, kind, day, category, opponent, recorded, outcome, questions, at, shown_at, points, rights, ms,
    started_at, finished_at, opponent_id, xp, scripted FROM runs;
DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;
CREATE UNIQUE INDEX runs_one_a_day ON runs (user_id, day) WHERE kind = 'day';
CREATE INDEX runs_board ON runs (day, rights DESC, points DESC, ms) WHERE kind = 'day' AND finished_at IS NOT NULL;
CREATE INDEX runs_user ON runs (user_id, started_at);
CREATE INDEX runs_recordings ON runs (finished_at) WHERE kind IN ('topic', 'duel') AND finished_at IS NOT NULL;
CREATE INDEX runs_opponent ON runs (user_id, opponent_id) WHERE opponent_id IS NOT NULL;
CREATE INDEX runs_finished ON runs (finished_at, user_id) WHERE finished_at IS NOT NULL;
CREATE INDEX runs_scripted ON runs (user_id) WHERE scripted;
