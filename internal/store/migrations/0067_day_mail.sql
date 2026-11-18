-- rebuild: mail by kind takes a second kind, the day's reminder by mail (server/daymail.go), for a player no
-- notification reaches who asks for it. Unlike the streak's mail it's off without a row. SQLite changes a CHECK only
-- by rebuilding the table (store.go).
CREATE TABLE mail_prefs_new (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind    TEXT    NOT NULL CHECK (kind IN ('streak', 'day')),
  wanted  INTEGER NOT NULL CHECK (wanted IN (0, 1)),
  PRIMARY KEY (user_id, kind)
) STRICT, WITHOUT ROWID;
INSERT INTO mail_prefs_new (user_id, kind, wanted) SELECT user_id, kind, wanted FROM mail_prefs;
DROP TABLE mail_prefs;
ALTER TABLE mail_prefs_new RENAME TO mail_prefs;

-- The day's reminders by mail, one row each, written before the mail is queued: one a day at most, never two for a
-- restart, and none after three since the player last played the day.
CREATE TABLE day_mails (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day     TEXT    NOT NULL, -- YYYY-MM-DD, in Bulgaria
  at      INTEGER NOT NULL, -- when, in ms
  PRIMARY KEY (user_id, day)
) STRICT, WITHOUT ROWID;
