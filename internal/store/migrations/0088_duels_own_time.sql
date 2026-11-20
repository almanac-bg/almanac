-- rebuild: a duel is played on one's own time (the owner's call, 20 Nov 2026: DECISIONS.md, „The redesign“), with a
-- friend (who plays the same ten when they can) or against a real recorded game, and there's no rating. So a duel says
-- which of the two it is (kind: person, recording), and when its first side was played and the other told (sent_at:
-- the friend's time runs from it); an outcome is a or b won, a draw (against a recording: the player a, the recording
-- b), or expired (no result: cut off, or not played in time). What only live duels and the rating had goes: the
-- rating's moves (deltas, ratings after, rated or not and why, new players), who left under way, and Начало's lines of
-- a live duel left (home_lines, left:<duel>). A duel still open (a live one the server cut) ends without a result. The
-- players' ratings and their count of rated games go with the rating's board. SQLite changes a CHECK only by
-- rebuilding the table (store.go); every column kept is copied, and the indexes are made again.
-- drops: duels.a_delta, duels.b_delta, duels.rated, duels.a_rating, duels.b_rating, duels.a_left, duels.b_left
-- drops: duels.unrated, duels.a_new, duels.b_new, users.rating, users.rated, users_rated
CREATE TABLE duels_new (
  id         INTEGER PRIMARY KEY,
  -- person: two players, a (who sent it, and played first) and b (who plays it when they can); recording: a against
  -- another's finished game (ghost_run).
  kind       TEXT    NOT NULL CHECK (kind IN ('person', 'recording')),
  questions  TEXT    NOT NULL, -- the picks (JSON), the same for both
  -- None: they've gone since (a result kept for the other).
  a_id       INTEGER REFERENCES users (id) ON DELETE SET NULL,
  a_run      INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  b_id       INTEGER REFERENCES users (id) ON DELETE SET NULL,
  b_run      INTEGER REFERENCES runs (id) ON DELETE SET NULL, -- none until b starts it
  ghost_run  INTEGER REFERENCES runs (id) ON DELETE SET NULL, -- the recording it's played against
  created_at INTEGER NOT NULL,
  sent_at    INTEGER, -- a person's: when a finished their side, and b was told
  expires_at INTEGER NOT NULL,
  ended_at   INTEGER,
  outcome    TEXT CHECK (outcome IN ('a', 'b', 'draw', 'expired'))
) STRICT;
INSERT INTO duels_new (id, kind, questions, a_id, a_run, b_id, b_run, ghost_run, created_at, sent_at, expires_at,
    ended_at, outcome)
  SELECT id, CASE WHEN ghost_run IS NOT NULL OR outcome GLOB 'ghost_*' THEN 'recording' ELSE 'person' END, questions,
    a_id, a_run, b_id, b_run, ghost_run, created_at, CASE WHEN ghost_run IS NULL THEN created_at END, expires_at,
    coalesce(ended_at, created_at),
    CASE outcome WHEN 'ghost_won' THEN 'a' WHEN 'ghost_lost' THEN 'b' WHEN 'ghost_draw' THEN 'draw'
      ELSE coalesce(outcome, 'expired') END
  FROM duels;
DROP TABLE duels;
ALTER TABLE duels_new RENAME TO duels;
CREATE INDEX duels_a ON duels (a_id, created_at);
CREATE INDEX duels_b ON duels (b_id, created_at) WHERE b_id IS NOT NULL;
CREATE INDEX duels_a_run ON duels (a_run);
CREATE INDEX duels_b_run ON duels (b_run);
CREATE INDEX duels_due ON duels (expires_at) WHERE ended_at IS NULL;
CREATE INDEX duels_ghost_run ON duels (ghost_run) WHERE ghost_run IS NOT NULL;

DELETE FROM home_lines WHERE what GLOB 'left:*';

DROP INDEX users_rated;
ALTER TABLE users DROP COLUMN rating;
ALTER TABLE users DROP COLUMN rated;
