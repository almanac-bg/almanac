-- rebuild: runs take a past issue too (kind 'past': a day's ten played after their day, from Минали броеве; play
-- past.go), one a player at most for each day. SQLite changes a CHECK only by rebuilding; what points to runs stays
-- (store.go). Every column is copied, and the indexes are made again as they are now.
CREATE TABLE runs_new (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('day', 'topic', 'challenge', 'duel', 'royal', 'mistakes', 'room', 'past')),
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
  shadow      INTEGER NOT NULL DEFAULT 0,
  told        INTEGER NOT NULL DEFAULT 0,
  room_game   TEXT,
  device      TEXT CHECK (device IN ('phone', 'tablet', 'desktop', 'app-ios', 'app-android')),
  players     INTEGER
) STRICT;
INSERT INTO runs_new (id, user_id, kind, day, category, opponent, recorded, outcome, questions, at, shown_at, points,
    rights, ms, started_at, finished_at, opponent_id, xp, shadow, told, room_game, device, players)
  SELECT id, user_id, kind, day, category, opponent, recorded, outcome, questions, at, shown_at, points, rights, ms,
    started_at, finished_at, opponent_id, xp, shadow, told, room_game, device, players FROM runs;
DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;
CREATE UNIQUE INDEX runs_one_a_day ON runs (user_id, day) WHERE kind = 'day';
CREATE INDEX runs_board ON runs (day, rights DESC, points DESC, ms) WHERE kind = 'day' AND finished_at IS NOT NULL;
CREATE INDEX runs_recordings ON runs (finished_at) WHERE kind IN ('topic', 'duel') AND finished_at IS NOT NULL;
CREATE INDEX runs_finished ON runs (finished_at, user_id) WHERE finished_at IS NOT NULL;
CREATE INDEX runs_opponent ON runs (opponent_id) WHERE opponent_id IS NOT NULL;
CREATE INDEX runs_shadow ON runs (user_id) WHERE shadow;
CREATE UNIQUE INDEX runs_room_game ON runs (room_game) WHERE room_game IS NOT NULL;
CREATE INDEX runs_user ON runs (user_id, started_at, at, finished_at, xp, told);
CREATE UNIQUE INDEX runs_one_past ON runs (user_id, day) WHERE kind = 'past';
