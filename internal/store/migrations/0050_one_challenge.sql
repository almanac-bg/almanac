-- rebuild: friends' duels and challenges become one thing, a challenge (play/challenges.go): a friend's duel is a
-- challenge sent to the friend. SQLite changes a CHECK only by rebuilding the table (store.go).
--
-- Each friend's duel becomes the friend's game of a challenge made of the challenger's game (its link, made here if it
-- had none): the friend is its taker (a), the challenger the one who sent it (b: the two are friends), and the
-- challenger's game is what it's played against (ghost_run). Those under way go on where they were (the challenger
-- still playing, the friend not told yet; the friend's turn; the friend half-way); those over keep their result, the
-- sides turned round. kind is live or challenge.

-- The challenger's game of each friend's duel becomes a challenge, as long as the duel had; one shared by its link
-- already keeps its code. A code is eight letters, as play.newInviteCode makes them; a second pass for one whose code
-- was taken.
INSERT OR IGNORE INTO challenges (code, user_id, run_id, created_at, expires_at)
  SELECT lower(hex(randomblob(4))), a_id, a_run, created_at, expires_at FROM duels
  WHERE kind = 'friend' AND challenge_id IS NULL AND a_run IS NOT NULL;
INSERT OR IGNORE INTO challenges (code, user_id, run_id, created_at, expires_at)
  SELECT lower(hex(randomblob(4))), a_id, a_run, created_at, expires_at FROM duels
  WHERE kind = 'friend' AND challenge_id IS NULL AND a_run IS NOT NULL;
UPDATE challenges SET expires_at = max(expires_at, (SELECT max(d.expires_at) FROM duels d
    WHERE d.kind = 'friend' AND d.challenge_id IS NULL AND d.a_run = challenges.run_id))
  WHERE run_id IN (SELECT a_run FROM duels WHERE kind = 'friend' AND challenge_id IS NULL);

-- A friend has one game of a challenge: one taken by its link besides their duel (the link brought them to the duel,
-- so there should be none) goes; and a friend's duel without the challenger's game (none should be) can't be played
-- or shown.
DELETE FROM duels WHERE challenge_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM duels f JOIN challenges c ON c.run_id = f.a_run
  WHERE f.kind = 'friend' AND f.challenge_id IS NULL AND c.id = duels.challenge_id AND f.b_id = duels.a_id);
DELETE FROM duels WHERE kind = 'friend' AND challenge_id IS NULL AND a_run IS NULL;

CREATE TABLE duels_new (
  id           INTEGER PRIMARY KEY,
  -- live: two players at once (or one against a recording); challenge: a taker's game of a challenge.
  kind         TEXT    NOT NULL CHECK (kind IN ('live', 'challenge')),
  questions    TEXT    NOT NULL, -- the picks (JSON), the same for both
  -- live: who started it; challenge: who takes it.
  a_id         INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  a_run        INTEGER REFERENCES runs (id) ON DELETE SET NULL, -- none yet: a friend it was sent to, not started
  -- live: the other player (none against a recording); challenge: the one who sent it, when the two are friends (a
  -- duel between them), none for anyone else.
  b_id         INTEGER REFERENCES users (id) ON DELETE CASCADE,
  b_run        INTEGER REFERENCES runs (id) ON DELETE SET NULL, -- live only
  -- live: the recording it's played against; challenge: the game of the one who sent it.
  ghost_run    INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  challenge_id INTEGER REFERENCES challenges (id) ON DELETE CASCADE,
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
  SELECT id, 'live', questions, a_id, a_run, b_id, b_run, ghost_run, NULL, created_at, expires_at,
    ended_at, outcome, a_delta, b_delta, rated, a_rating, b_rating, a_left, b_left
  FROM duels WHERE kind = 'live';
INSERT INTO duels_new (id, kind, questions, a_id, a_run, b_id, b_run, ghost_run, challenge_id, created_at, expires_at,
    ended_at, outcome, a_delta, b_delta, rated, a_rating, b_rating, a_left, b_left)
  SELECT id, 'challenge', questions, a_id, a_run, NULL, NULL, ghost_run, challenge_id, created_at, expires_at,
    ended_at, outcome, a_delta, b_delta, rated, a_rating, b_rating, NULL, NULL
  FROM duels WHERE kind = 'friend' AND challenge_id IS NOT NULL;
INSERT INTO duels_new (id, kind, questions, a_id, a_run, b_id, b_run, ghost_run, challenge_id, created_at, expires_at,
    ended_at, outcome, a_delta, b_delta, rated, a_rating, b_rating, a_left, b_left)
  SELECT d.id, 'challenge', d.questions, d.b_id, d.b_run, d.a_id, NULL, d.a_run, c.id, d.created_at, d.expires_at,
    d.ended_at, CASE d.outcome WHEN 'a' THEN 'b' WHEN 'b' THEN 'a' ELSE d.outcome END, d.b_delta, d.a_delta, d.rated,
    d.b_rating, d.a_rating, NULL, NULL
  FROM duels d JOIN challenges c ON c.run_id = d.a_run WHERE d.kind = 'friend' AND d.challenge_id IS NULL;
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
