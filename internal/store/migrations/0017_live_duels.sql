-- rebuild: a duel with whoever comes is played live (internal/live), against a recording if nobody comes; a friend
-- is still challenged in their own time. SQLite changes a CHECK only by rebuilding the table (store.go). Open duels
-- still waiting end without a result; a recording stays only on the duels settled against it. And whether a duel
-- moved ratings: only the first of a day between the same two players does.
CREATE TABLE duels_new (
  id         INTEGER PRIMARY KEY,
  -- live: two players at once (or one against a recording); friend: a friend challenged, each in their own time.
  kind       TEXT    NOT NULL CHECK (kind IN ('live', 'friend')),
  questions  TEXT    NOT NULL, -- the picks (JSON), the same for both
  a_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE, -- who started it
  a_run      INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  b_id       INTEGER REFERENCES users (id) ON DELETE CASCADE, -- the other player (none against a recording)
  b_run      INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  ghost_run  INTEGER REFERENCES runs (id) ON DELETE SET NULL, -- the recording a live duel is played against
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ended_at   INTEGER,
  -- a or b won, a draw, against the recording (ghost: a won, lost or drew), turned down, or no result.
  outcome    TEXT CHECK (outcome IN ('a', 'b', 'draw', 'ghost_won', 'ghost_lost', 'ghost_draw', 'declined', 'expired')),
  a_delta    INTEGER,
  b_delta    INTEGER,
  rated      INTEGER NOT NULL DEFAULT 1 -- 0: a friendly (the two had a rated duel that day already)
) STRICT;
INSERT INTO duels_new (id, kind, questions, a_id, a_run, b_id, b_run, ghost_run, created_at, expires_at, ended_at, outcome,
    a_delta, b_delta)
  SELECT id, CASE kind WHEN 'open' THEN 'live' ELSE kind END, questions, a_id, a_run, b_id, b_run,
    CASE WHEN outcome LIKE 'ghost_%' THEN ghost_run END, created_at, expires_at,
    CASE WHEN kind = 'open' AND ended_at IS NULL THEN CAST(strftime('%s', 'now') AS INTEGER) * 1000 ELSE ended_at END,
    CASE WHEN kind = 'open' AND ended_at IS NULL THEN 'expired' ELSE outcome END,
    a_delta, b_delta
  FROM duels;
DROP TABLE duels;
ALTER TABLE duels_new RENAME TO duels;
CREATE INDEX duels_a ON duels (a_id, created_at);
CREATE INDEX duels_b ON duels (b_id, created_at) WHERE b_id IS NOT NULL;
CREATE INDEX duels_a_run ON duels (a_run);
CREATE INDEX duels_b_run ON duels (b_run);
CREATE INDEX duels_due ON duels (expires_at) WHERE ended_at IS NULL;
