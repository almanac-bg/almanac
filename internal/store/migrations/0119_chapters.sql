-- rebuild: one name for a chapter. A game of one chapter (or of every chapter at once, „mix“) is of the kind 'chapter',
-- not 'topic', and the chapter it's of is runs.chapter, not runs.category: the player's noun is „глава“, and
-- „category“ is the bank's word for it alone. SQLite changes a CHECK only by rebuilding the table (store.go); every
-- column kept is copied, and the indexes are made again as they are now.
-- drops: runs.category
CREATE TABLE runs_new (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('day', 'chapter', 'duel')),
  day         TEXT,
  chapter     TEXT,
  questions   TEXT    NOT NULL,
  at          INTEGER NOT NULL DEFAULT 0,
  shown_at    INTEGER,
  rights      INTEGER NOT NULL DEFAULT 0,
  closeness   INTEGER NOT NULL DEFAULT 0,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  shadow      INTEGER NOT NULL DEFAULT 0,
  told        INTEGER NOT NULL DEFAULT 0,
  pencil      INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO runs_new (id, user_id, kind, day, chapter, questions, at, shown_at, rights, closeness, started_at,
    finished_at, shadow, told, pencil)
  SELECT id, user_id, CASE kind WHEN 'topic' THEN 'chapter' ELSE kind END, day, category, questions, at, shown_at,
    rights, closeness, started_at, finished_at, shadow, told, pencil
  FROM runs;
DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;
CREATE UNIQUE INDEX runs_one_a_day ON runs (user_id, day) WHERE kind = 'day';
CREATE INDEX runs_board ON runs (day, rights DESC, closeness DESC) WHERE kind = 'day' AND finished_at IS NOT NULL;
CREATE INDEX runs_recordings ON runs (finished_at) WHERE kind IN ('chapter', 'duel') AND finished_at IS NOT NULL;
CREATE INDEX runs_finished ON runs (finished_at, user_id) WHERE finished_at IS NOT NULL;
CREATE INDEX runs_shadow ON runs (user_id) WHERE shadow;
CREATE INDEX runs_user ON runs (user_id, started_at, at, finished_at, told);
