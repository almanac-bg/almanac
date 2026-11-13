-- rebuild: every player gets a tag of their own (@tag: how friends find them), and names stop being unique — two
-- people may well share one. SQLite drops a UNIQUE only by rebuilding the table (store.go, rebuildMark).
CREATE TABLE users_new (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  -- The tag: latin letters, digits and underscores, kept lowercase (account.NormalTag), unique.
  tag        TEXT    NOT NULL UNIQUE,
  email      TEXT    UNIQUE,
  admin      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  seen_at    INTEGER NOT NULL,
  invite     TEXT,
  avatar     TEXT,
  title      TEXT,
  level_seen INTEGER NOT NULL DEFAULT 1
) STRICT;
INSERT INTO users_new (id, name, tag, email, admin, created_at, seen_at, invite, avatar, title, level_seen)
  SELECT id, name, 'player' || id, email, admin, created_at, seen_at, invite, avatar, title, level_seen FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE UNIQUE INDEX users_invite ON users (invite) WHERE invite IS NOT NULL;

-- Friend requests: to a player by their tag, or to an email — whoever has that address, or signs in with it later.
-- The sender is never told whether anyone does.
CREATE TABLE friend_requests (
  id       INTEGER PRIMARY KEY,
  from_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_id    INTEGER REFERENCES users (id) ON DELETE CASCADE,
  to_email TEXT,
  at       INTEGER NOT NULL,
  CHECK ((to_id IS NULL) != (to_email IS NULL))
) STRICT;
CREATE UNIQUE INDEX friend_requests_to_player ON friend_requests (from_id, to_id) WHERE to_id IS NOT NULL;
CREATE UNIQUE INDEX friend_requests_to_email ON friend_requests (from_id, to_email) WHERE to_email IS NOT NULL;
CREATE INDEX friend_requests_player ON friend_requests (to_id) WHERE to_id IS NOT NULL;
CREATE INDEX friend_requests_email ON friend_requests (to_email) WHERE to_email IS NOT NULL;
