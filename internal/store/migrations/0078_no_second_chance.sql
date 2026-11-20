-- rebuild: Втори шанс is gone (the owner's call, 20 Nov 2026: DECISIONS.md), and a game of every topic at once is
-- „Микс“, a topic of its own (play.MixTopic). Runs take no second chance's kind any more: a game played in one stays
-- the player's, as a game of „Микс“ (its questions were of every topic), and so do the games of every topic kept so
-- far without a topic (a first challenge's, a past issue's: 0076, 0077). SQLite changes a CHECK only by rebuilding the
-- table (store.go); every column is copied, and the indexes are made again as they are now. The day's goal of three
-- questions fixed in Втори шанс goes: one still to do is drawn again (its day's goals are, on the next look, by
-- today's rules); one done stays done, with its XP, and isn't told any more.
CREATE TABLE runs_new (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('day', 'topic', 'duel', 'royal', 'room')),
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
  SELECT id, user_id, CASE kind WHEN 'mistakes' THEN 'topic' ELSE kind END, day,
    CASE WHEN kind IN ('topic', 'mistakes') AND coalesce(category, '') = '' THEN 'mix' ELSE category END, opponent,
    recorded, outcome, questions, at, shown_at, points, rights, ms, started_at, finished_at, opponent_id, xp, shadow,
    told, room_game, device, players
  FROM runs;
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

DELETE FROM day_goals WHERE (user_id, day) IN (SELECT user_id, day FROM day_goals g WHERE goal = 'mended3'
  AND NOT EXISTS (SELECT 1 FROM goals_done d WHERE d.user_id = g.user_id AND d.day = g.day AND d.goal = 'mended3'));
UPDATE goals_done SET seen = 1 WHERE goal = 'mended3';
