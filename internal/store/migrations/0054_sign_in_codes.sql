-- A sign-in code is the browser's that asked for it, not the address's (review 2026-11-17, S3): each browser has a
-- code of its own, which nobody else can replace, try or use up. Codes on their way at the deploy are dropped: they
-- were the address's, and a new one is a tap away.
DROP TABLE email_codes;
CREATE TABLE sign_in_codes (
  asker      BLOB    PRIMARY KEY, -- the hash of the token the browser that asked keeps (its ask cookie)
  email      TEXT    NOT NULL,
  code_hash  BLOB    NOT NULL,
  digits     INTEGER NOT NULL,
  sent_at    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0,
  mail       INTEGER              -- its mail in the outbox (it may have gone): dropped if the code is replaced
) STRICT, WITHOUT ROWID;
CREATE INDEX sign_in_codes_expiry ON sign_in_codes (expires_at);

-- The wrong codes given for an address, from any browser, since a time (account.Misses, account.MissesKept).
CREATE TABLE code_misses (
  email  TEXT    PRIMARY KEY,
  misses INTEGER NOT NULL,
  since  INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

-- A mail worth sending only for a while (a sign-in code) goes before the rest, and is dropped once its time is out
-- (review 2026-11-17, S4). Ids are never used twice (AUTOINCREMENT): a code's mail is dropped by its id, which must
-- not by then be another's mail.
CREATE TABLE outbox_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message    TEXT    NOT NULL, -- JSON: to, subject, text
  attempts   INTEGER NOT NULL DEFAULT 0,
  next_at    INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  urgent     INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER
) STRICT;
INSERT INTO outbox_new (id, message, attempts, next_at, last_error, created_at)
  SELECT id, message, attempts, next_at, last_error, created_at FROM outbox;
DROP TABLE outbox;
ALTER TABLE outbox_new RENAME TO outbox;
CREATE INDEX outbox_due ON outbox (urgent DESC, next_at);
