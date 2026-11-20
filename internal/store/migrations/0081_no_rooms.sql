-- rebuild: rooms are gone (the owner's call, 20 Nov 2026: DECISIONS.md). The games played in rooms stay the players'
-- games, each a game of its own: a game of its one topic, or of „Микс“ (every topic at once) when it had several, as
-- second chances' and the games of every topic became (0078). Runs lose what only a room's game had: the id it was
-- kept once by (room_game, with its index) and how many played it (players); and take no room's kind any more. A
-- player who came in by a room's link came from somewhere else as far as anyone can tell now (other), and the counts
-- of those links' visits and guests go. The rebuild also lets go of the app's devices, which no game has since 0080.
-- SQLite changes a CHECK only by rebuilding the table (store.go); every column
-- kept is copied, and the indexes are made again as they are now.
-- drops: runs.room_game, runs.players, runs_room_game
UPDATE users SET came_from = 'other' WHERE came_from = 'room';
DELETE FROM daily_counts WHERE key IN ('visit:room', 'guest:room');

CREATE TABLE runs_new (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('day', 'topic', 'duel', 'royal')),
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
  device      TEXT CHECK (device IN ('phone', 'tablet', 'desktop'))
) STRICT;
INSERT INTO runs_new (id, user_id, kind, day, category, opponent, recorded, outcome, questions, at, shown_at, points,
    rights, ms, started_at, finished_at, opponent_id, xp, shadow, told, device)
  SELECT id, user_id, CASE kind WHEN 'room' THEN 'topic' ELSE kind END, day,
    CASE WHEN kind = 'room' AND coalesce(category, '') = '' THEN 'mix' ELSE category END, opponent, recorded, outcome,
    questions, at, shown_at, points, rights, ms, started_at, finished_at, opponent_id, xp, shadow, told, device
  FROM runs;
DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;
CREATE UNIQUE INDEX runs_one_a_day ON runs (user_id, day) WHERE kind = 'day';
CREATE INDEX runs_board ON runs (day, rights DESC, points DESC, ms) WHERE kind = 'day' AND finished_at IS NOT NULL;
CREATE INDEX runs_recordings ON runs (finished_at) WHERE kind IN ('topic', 'duel') AND finished_at IS NOT NULL;
CREATE INDEX runs_finished ON runs (finished_at, user_id) WHERE finished_at IS NOT NULL;
CREATE INDEX runs_opponent ON runs (opponent_id) WHERE opponent_id IS NOT NULL;
CREATE INDEX runs_shadow ON runs (user_id) WHERE shadow;
CREATE INDEX runs_user ON runs (user_id, started_at, at, finished_at, xp, told);
