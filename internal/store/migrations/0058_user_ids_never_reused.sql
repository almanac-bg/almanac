-- rebuild: a player's id is never given to another, even after they've gone (AUTOINCREMENT): what's kept of a player
-- by their id without a reference to users (active_days, kept for the retention counts) or outside the database (a
-- limit's key, a room kept over a restart) never becomes a newcomer's. Without it SQLite gives the highest id again
-- once its player is deleted. SQLite adds AUTOINCREMENT only by rebuilding the table (store.go, rebuildMark).
CREATE TABLE users_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  -- The tag: latin letters, digits and underscores, kept lowercase (account.NormalTag), unique.
  tag              TEXT    NOT NULL UNIQUE,
  email            TEXT    UNIQUE,
  admin            INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  seen_at          INTEGER NOT NULL,
  invite           TEXT,
  avatar           TEXT,
  title            TEXT,
  level_seen       INTEGER NOT NULL DEFAULT 1,
  rating           INTEGER NOT NULL DEFAULT 1000,
  rated            INTEGER NOT NULL DEFAULT 0,
  frame            TEXT,
  backdrop         TEXT,
  peak             INTEGER NOT NULL DEFAULT 1000,
  unlocks_known    INTEGER NOT NULL DEFAULT 1,
  peak_seen        INTEGER NOT NULL DEFAULT 1000,
  league           INTEGER NOT NULL DEFAULT 0,
  systems_told     TEXT    NOT NULL DEFAULT '',
  came_from        TEXT,
  recordings_told  INTEGER NOT NULL DEFAULT 0,
  streak_told      TEXT    NOT NULL DEFAULT '',
  challenges_told  INTEGER NOT NULL DEFAULT 0,
  challenge_pushed INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO users_new (id, name, tag, email, admin, created_at, seen_at, invite, avatar, title, level_seen, rating,
    rated, frame, backdrop, peak, unlocks_known, peak_seen, league, systems_told, came_from, recordings_told,
    streak_told, challenges_told, challenge_pushed)
  SELECT id, name, tag, email, admin, created_at, seen_at, invite, avatar, title, level_seen, rating,
    rated, frame, backdrop, peak, unlocks_known, peak_seen, league, systems_told, came_from, recordings_told,
    streak_told, challenges_told, challenge_pushed
  FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE UNIQUE INDEX users_invite ON users (invite) WHERE invite IS NOT NULL;
CREATE INDEX users_rated ON users (rating DESC, rated DESC) WHERE rated >= 10;
CREATE INDEX users_guests_seen ON users (seen_at) WHERE email IS NULL;

-- The days of players who went before this keep no id of anyone's: a tombstone, the id made negative, as play.Forget
-- leaves them from now on. The ids go on after the highest any player has had, theirs too.
UPDATE OR REPLACE active_days SET user_id = -user_id WHERE user_id > 0 AND user_id NOT IN (SELECT id FROM users);
DELETE FROM sqlite_sequence WHERE name = 'users';
INSERT INTO sqlite_sequence (name, seq)
  SELECT 'users', max((SELECT coalesce(max(id), 0) FROM users), (SELECT coalesce(max(-user_id), 0) FROM active_days));
