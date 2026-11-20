-- Ranks per chapter from ink (the owner's call, 2026-11-20: DECISIONS.md „The direction“; play/rank.go): kept as a
-- day's issue finishes, never falling, each with the quarters toward the next and the ink it was counted from; a rank
-- risen waits to be told (told: the level last told). The players with ink already are counted as the server starts
-- (ranks_due: the rank needs the bank, to know which facts count, and how a guess fares by kind), quietly. The chapter
-- whose seal a player wears is theirs to choose (users.seal; none: their best).
CREATE TABLE ranks (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  chapter TEXT    NOT NULL, -- a topic of the bank's
  level   INTEGER NOT NULL, -- 1 Бележка … 6 Летопис, 7 „Летопис · 2“ and on
  quarter INTEGER NOT NULL DEFAULT 0 CHECK (quarter BETWEEN 0 AND 3), -- toward the next
  ink     INTEGER NOT NULL, -- the chapter's ink as counted
  day     TEXT    NOT NULL, -- the day it rose to its level (YYYY-MM-DD)
  told    INTEGER NOT NULL DEFAULT 0, -- the level last told
  PRIMARY KEY (user_id, chapter)
) STRICT, WITHOUT ROWID;

CREATE TABLE ranks_due (
  user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE
) STRICT;
INSERT INTO ranks_due (user_id) SELECT DISTINCT user_id FROM facts WHERE ink;

ALTER TABLE users ADD COLUMN seal TEXT;

-- The issue played a second time in one browser (the browser started it before as someone else: a sign-out, a
-- handoff) writes pencil, not ink: its answers were in sight there (play/ink.go).
ALTER TABLE runs ADD COLUMN pencil INTEGER NOT NULL DEFAULT 0;
