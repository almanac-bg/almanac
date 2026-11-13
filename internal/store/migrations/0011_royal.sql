-- rebuild: runs take Роял too (SQLite changes a CHECK only by rebuilding; what points to runs stays, store.go). And
-- Роял's tournaments: up to 20 players on the same questions, each in their own time, a wrong answer out.
CREATE TABLE runs_new (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('day', 'topic', 'challenge', 'duel', 'royal')),
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
  opponent_id INTEGER REFERENCES users (id) ON DELETE SET NULL
) STRICT;
INSERT INTO runs_new (id, user_id, kind, day, category, opponent, recorded, outcome, questions, at, shown_at, points,
    rights, ms, started_at, finished_at, opponent_id)
  SELECT id, user_id, kind, day, category, opponent, recorded, outcome, questions, at, shown_at, points, rights, ms,
    started_at, finished_at, opponent_id FROM runs;
DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;
CREATE UNIQUE INDEX runs_one_a_day ON runs (user_id, day) WHERE kind = 'day';
CREATE INDEX runs_board ON runs (day, points DESC, ms) WHERE kind = 'day' AND finished_at IS NOT NULL;
CREATE INDEX runs_user ON runs (user_id, started_at);
CREATE INDEX runs_recordings ON runs (finished_at) WHERE kind IN ('topic', 'duel') AND finished_at IS NOT NULL;
CREATE INDEX runs_opponent ON runs (user_id, opponent_id) WHERE opponent_id IS NOT NULL;

CREATE TABLE royals (
  id         INTEGER PRIMARY KEY,
  questions  TEXT    NOT NULL, -- the picks (JSON), the same for everyone in it
  created_at INTEGER NOT NULL,
  closes_at  INTEGER NOT NULL,
  ended_at   INTEGER
) STRICT;
CREATE INDEX royals_open ON royals (created_at) WHERE ended_at IS NULL;

CREATE TABLE royal_players (
  royal_id  INTEGER NOT NULL REFERENCES royals (id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  run_id    INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  joined_at INTEGER NOT NULL,
  place     INTEGER, -- once it's ended
  delta     INTEGER, -- what it did to their rating
  PRIMARY KEY (royal_id, user_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX royal_players_user ON royal_players (user_id, joined_at);
