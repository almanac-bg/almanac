-- rebuild: runs take no past issue any more (0075), and mail by kind no year's word. A past issue's finished game
-- stays as a game of every topic (kind 'topic', no day): what it earned stays the player's. SQLite changes a CHECK
-- only by rebuilding; what points to runs stays (store.go). Every column is copied, and the indexes are made again as
-- they are now, but the one that kept a past issue to one game a player.
-- drops: runs_one_past
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
  shadow      INTEGER NOT NULL DEFAULT 0,
  told        INTEGER NOT NULL DEFAULT 0,
  room_game   TEXT,
  device      TEXT CHECK (device IN ('phone', 'tablet', 'desktop', 'app-ios', 'app-android')),
  players     INTEGER
) STRICT;
INSERT INTO runs_new (id, user_id, kind, day, category, opponent, recorded, outcome, questions, at, shown_at, points,
    rights, ms, started_at, finished_at, opponent_id, xp, shadow, told, room_game, device, players)
  SELECT id, user_id, CASE kind WHEN 'past' THEN 'topic' ELSE kind END, CASE kind WHEN 'past' THEN NULL ELSE day END,
    category, opponent, recorded, outcome, questions, at, shown_at, points, rights, ms, started_at, finished_at,
    opponent_id, xp, shadow, told, room_game, device, players FROM runs;
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

CREATE TABLE mail_prefs_new (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind    TEXT    NOT NULL CHECK (kind IN ('streak', 'day')),
  wanted  INTEGER NOT NULL CHECK (wanted IN (0, 1)),
  PRIMARY KEY (user_id, kind)
) STRICT, WITHOUT ROWID;
INSERT INTO mail_prefs_new (user_id, kind, wanted) SELECT user_id, kind, wanted FROM mail_prefs WHERE kind <> 'year';
DROP TABLE mail_prefs;
ALTER TABLE mail_prefs_new RENAME TO mail_prefs;
