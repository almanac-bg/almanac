-- A challenge: a link (/c/<code>) to a player's finished game of ten, for anyone who opens it to play the same
-- questions as a duel against it (play/challenges.go). One per game; it lasts until expires_at.
CREATE TABLE challenges (
  id         INTEGER PRIMARY KEY,
  code       TEXT    NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  run_id     INTEGER NOT NULL UNIQUE REFERENCES runs (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX challenges_user ON challenges (user_id, created_at);
-- A taker's duel: against the challenge's game (ghost_run), as a duel against a recording is.
ALTER TABLE duels ADD COLUMN challenge_id INTEGER REFERENCES challenges (id) ON DELETE CASCADE;
CREATE INDEX duels_challenge ON duels (challenge_id) WHERE challenge_id IS NOT NULL;
-- When a player last heard, on Начало, who played their challenges; and when a push last told them of one (once a
-- day at most).
ALTER TABLE users ADD COLUMN challenges_told INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN challenge_pushed INTEGER NOT NULL DEFAULT 0;
