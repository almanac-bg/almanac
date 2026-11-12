-- Browsers that asked for notifications (Web Push), and a little state the game keeps between restarts.
CREATE TABLE push_subs (
  endpoint   TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX push_subs_user ON push_subs (user_id);

CREATE TABLE kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID;
