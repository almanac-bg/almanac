-- rebuild: mail by kind takes a third kind, the year's word (server/yearword.go): on without a row, as the streak's is,
-- and stopped by the link in the mail itself. SQLite changes a CHECK only by rebuilding the table (store.go).
CREATE TABLE mail_prefs_new (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind    TEXT    NOT NULL CHECK (kind IN ('streak', 'day', 'year')),
  wanted  INTEGER NOT NULL CHECK (wanted IN (0, 1)),
  PRIMARY KEY (user_id, kind)
) STRICT, WITHOUT ROWID;
INSERT INTO mail_prefs_new (user_id, kind, wanted) SELECT user_id, kind, wanted FROM mail_prefs;
DROP TABLE mail_prefs;
ALTER TABLE mail_prefs_new RENAME TO mail_prefs;

-- The year's word, once a year in December („Твоята 2026 в АЛМАНАХ“), one row a player and year, written before it's
-- queued (a notification, or else a mail): never two, a restart or not. One held out of the reminders (play
-- experiment.go) is claimed the same and marked held, when it would have gone as a notification.
CREATE TABLE year_words (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  year    INTEGER NOT NULL,
  at      INTEGER NOT NULL, -- when, in ms
  how     TEXT    NOT NULL CHECK (how IN ('push', 'mail')),
  held    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, year)
) STRICT, WITHOUT ROWID;
