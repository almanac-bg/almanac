-- rebuild: challenges, invite links and sharing are gone (the owner's call, 19 Nov 2026: DECISIONS.md). A duel is a
-- live one only, against a person or a recording: the challenges' duels go with the challenges, and duels lose their
-- kind (live, always), their challenge, the outcome only a challenge had (declined) and the reason only a challenge
-- moved no rating (known). The games played in challenges stay the players' games. The players' invite codes go, and
-- what they were told of their challenges; a player who came in by a shared day or an invite came from somewhere
-- else as far as anyone can tell now (other), and the counts of shares and of those links' visits go. Runs take no
-- challenge's kind any more: a game kept from the first challenges (before 0007) stays as a game of every topic (kind
-- 'topic'). SQLite changes a CHECK only by rebuilding the table (store.go); every column kept is copied, and the
-- indexes are made again as they are now.
-- drops: challenges, challenges_user, challenges_for, duels.kind, duels.challenge_id, duels_challenge, duels_taker, users.invite, users_invite, users.challenges_told, users.challenge_pushed
DELETE FROM duels WHERE kind = 'challenge';
CREATE TABLE duels_new (
  id           INTEGER PRIMARY KEY,
  questions    TEXT    NOT NULL, -- the picks (JSON), the same for both
  -- who started it. None: they've gone since (a result kept for b).
  a_id         INTEGER REFERENCES users (id) ON DELETE SET NULL,
  a_run        INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  -- the other player (none against a recording). None too once they've gone (a result kept for a).
  b_id         INTEGER REFERENCES users (id) ON DELETE SET NULL,
  b_run        INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  ghost_run    INTEGER REFERENCES runs (id) ON DELETE SET NULL, -- the recording it's played against
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  -- a or b won, a draw, against the game played back (ghost: a won, lost or drew), or no result (cut off).
  outcome      TEXT CHECK (outcome IN ('a', 'b', 'draw', 'ghost_won', 'ghost_lost', 'ghost_draw', 'expired')),
  a_delta      INTEGER,
  b_delta      INTEGER,
  rated        INTEGER NOT NULL DEFAULT 1, -- 0: it didn't move ratings
  a_rating     INTEGER,
  b_rating     INTEGER,
  a_left       INTEGER,
  b_left       INTEGER,
  unrated      TEXT CHECK (unrated IN ('again', 'recordings', 'network', 'newcomers')),
  a_new        INTEGER NOT NULL DEFAULT 0,
  b_new        INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO duels_new (id, questions, a_id, a_run, b_id, b_run, ghost_run, created_at, expires_at, ended_at, outcome,
    a_delta, b_delta, rated, a_rating, b_rating, a_left, b_left, unrated, a_new, b_new)
  SELECT id, questions, a_id, a_run, b_id, b_run, ghost_run, created_at, expires_at, ended_at, outcome,
    a_delta, b_delta, rated, a_rating, b_rating, a_left, b_left, unrated, a_new, b_new FROM duels;
DROP TABLE duels;
ALTER TABLE duels_new RENAME TO duels;
CREATE INDEX duels_a ON duels (a_id, created_at);
CREATE INDEX duels_b ON duels (b_id, created_at) WHERE b_id IS NOT NULL;
CREATE INDEX duels_a_run ON duels (a_run);
CREATE INDEX duels_b_run ON duels (b_run);
CREATE INDEX duels_due ON duels (expires_at) WHERE ended_at IS NULL;
CREATE INDEX duels_ghost_run ON duels (ghost_run) WHERE ghost_run IS NOT NULL;
DROP TABLE challenges;

DROP INDEX users_invite;
ALTER TABLE users DROP COLUMN invite;
ALTER TABLE users DROP COLUMN challenges_told;
ALTER TABLE users DROP COLUMN challenge_pushed;
UPDATE users SET came_from = 'other' WHERE came_from IN ('share', 'invite');
DELETE FROM daily_counts WHERE key LIKE 'share:%' OR key IN ('visit:share', 'visit:invite', 'guest:share', 'guest:invite');

CREATE TABLE runs_new (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('day', 'topic', 'duel', 'royal', 'mistakes', 'room')),
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
  SELECT id, user_id, CASE kind WHEN 'challenge' THEN 'topic' ELSE kind END, day,
    CASE kind WHEN 'challenge' THEN coalesce(category, '') ELSE category END, opponent, recorded, outcome, questions, at,
    shown_at, points, rights, ms, started_at, finished_at, opponent_id, xp, shadow, told, room_game, device, players
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
