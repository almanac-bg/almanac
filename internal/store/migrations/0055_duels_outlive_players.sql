-- rebuild: a duel's result is both players' history, so a player who goes (deletes their account, or a guest
-- cleared) no longer takes it from the other: their side becomes none (ON DELETE SET NULL), and the other keeps the
-- duel, their wins, their record and what counts toward an achievement. A challenge goes with its sender's game, and
-- the duels its takers finished stay theirs. What was the player's alone, and duels with no result yet, go as they
-- do (play.Forget). SQLite changes a reference's action only by rebuilding the table (store.go).
CREATE TABLE duels_new (
  id           INTEGER PRIMARY KEY,
  -- live: two players at once (or one against a recording); challenge: a taker's game of a challenge.
  kind         TEXT    NOT NULL CHECK (kind IN ('live', 'challenge')),
  questions    TEXT    NOT NULL, -- the picks (JSON), the same for both
  -- live: who started it; challenge: who takes it. None: they've gone since (a result kept for b).
  a_id         INTEGER REFERENCES users (id) ON DELETE SET NULL,
  a_run        INTEGER REFERENCES runs (id) ON DELETE SET NULL, -- none yet: a friend it was sent to, not started
  -- live: the other player (none against a recording); challenge: the one who sent it, when the two are friends (a
  -- duel between them), none for anyone else. None too once they've gone (a result kept for a).
  b_id         INTEGER REFERENCES users (id) ON DELETE SET NULL,
  b_run        INTEGER REFERENCES runs (id) ON DELETE SET NULL, -- live only
  -- live: the recording it's played against; challenge: the game of the one who sent it.
  ghost_run    INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  challenge_id INTEGER REFERENCES challenges (id) ON DELETE SET NULL, -- none once the challenge has gone
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  -- a or b won, a draw, against the game played back (ghost: a won, lost or drew), turned down, or no result.
  outcome      TEXT CHECK (outcome IN ('a', 'b', 'draw', 'ghost_won', 'ghost_lost', 'ghost_draw', 'declined', 'expired')),
  a_delta      INTEGER,
  b_delta      INTEGER,
  rated        INTEGER NOT NULL DEFAULT 1, -- 0: it didn't move ratings
  a_rating     INTEGER,
  b_rating     INTEGER,
  a_left       INTEGER,
  b_left       INTEGER
) STRICT;
INSERT INTO duels_new (id, kind, questions, a_id, a_run, b_id, b_run, ghost_run, challenge_id, created_at, expires_at,
    ended_at, outcome, a_delta, b_delta, rated, a_rating, b_rating, a_left, b_left)
  SELECT id, kind, questions, a_id, a_run, b_id, b_run, ghost_run, challenge_id, created_at, expires_at,
    ended_at, outcome, a_delta, b_delta, rated, a_rating, b_rating, a_left, b_left
  FROM duels;
DROP TABLE duels;
ALTER TABLE duels_new RENAME TO duels;
CREATE INDEX duels_a ON duels (a_id, created_at);
CREATE INDEX duels_b ON duels (b_id, created_at) WHERE b_id IS NOT NULL;
CREATE INDEX duels_a_run ON duels (a_run);
CREATE INDEX duels_b_run ON duels (b_run);
CREATE INDEX duels_due ON duels (expires_at) WHERE ended_at IS NULL;
CREATE INDEX duels_ghost_run ON duels (ghost_run) WHERE ghost_run IS NOT NULL;
CREATE INDEX duels_challenge ON duels (challenge_id) WHERE challenge_id IS NOT NULL;
CREATE UNIQUE INDEX duels_taker ON duels (challenge_id, a_id) WHERE challenge_id IS NOT NULL;
