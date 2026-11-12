-- Players, how they sign in, and the mail the game sends. Times are milliseconds since 1970.

-- A player. A guest has no email yet: adding one keeps the account, and is how it's kept across devices.
CREATE TABLE users (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  -- The name as compared: lowercased (Cyrillic too, which SQLite's NOCASE doesn't fold), so names are unique by it.
  name_key   TEXT    NOT NULL UNIQUE,
  email      TEXT    UNIQUE,
  admin      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  seen_at    INTEGER NOT NULL
) STRICT;

-- A signed-in browser. Only the token's hash is kept: a copy of the database signs nobody in.
CREATE TABLE sessions (
  token_hash BLOB    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  seen_at    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

-- The code last mailed to an address, until it's used, expires, or runs out of tries.
CREATE TABLE email_codes (
  email      TEXT    PRIMARY KEY,
  code_hash  BLOB    NOT NULL,
  sent_at    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0
) STRICT, WITHOUT ROWID;

-- Mail waiting to go out, retried until it does (or gives up).
CREATE TABLE outbox (
  id         INTEGER PRIMARY KEY,
  message    TEXT    NOT NULL, -- JSON: to, subject, text
  attempts   INTEGER NOT NULL DEFAULT 0,
  next_at    INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX outbox_next ON outbox (next_at);
