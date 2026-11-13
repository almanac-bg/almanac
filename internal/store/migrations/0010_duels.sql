-- Duels in a player's own time — two players, the same ten questions, each played whenever they can — and a rating
-- that duels move (Elo), shown as a division (play.Divisions).
ALTER TABLE users ADD COLUMN rating INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE users ADD COLUMN rated INTEGER NOT NULL DEFAULT 0; -- rated duels played

CREATE TABLE duels (
  id         INTEGER PRIMARY KEY,
  -- open: anyone may take it; friend: one friend asked.
  kind       TEXT    NOT NULL CHECK (kind IN ('open', 'friend')),
  questions  TEXT    NOT NULL, -- the picks (JSON), the same for both
  a_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE, -- who started it
  a_run      INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  b_id       INTEGER REFERENCES users (id) ON DELETE CASCADE, -- the friend asked, or whoever took an open one
  b_run      INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  -- A recorded run on the same questions: an open duel nobody takes in time is settled against it.
  ghost_run  INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ended_at   INTEGER,
  -- a or b won, a draw, settled against the recording (ghost: a won, lost or drew it), turned down, or no game.
  outcome    TEXT CHECK (outcome IN ('a', 'b', 'draw', 'ghost_won', 'ghost_lost', 'ghost_draw', 'declined', 'expired')),
  a_delta    INTEGER,
  b_delta    INTEGER
) STRICT;
CREATE INDEX duels_open ON duels (created_at) WHERE kind = 'open' AND b_id IS NULL AND ended_at IS NULL;
CREATE INDEX duels_a ON duels (a_id, created_at);
CREATE INDEX duels_b ON duels (b_id, created_at) WHERE b_id IS NOT NULL;
CREATE INDEX duels_a_run ON duels (a_run);
CREATE INDEX duels_b_run ON duels (b_run);
CREATE INDEX duels_due ON duels (expires_at) WHERE ended_at IS NULL;
