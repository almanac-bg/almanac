-- Mail by kind (server/streakmail.go): each player may turn a kind off, in Настройки or by the link in the mail
-- itself (a kind with no row here is on). The only kind so far: a streak that ended.
CREATE TABLE mail_prefs (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind    TEXT    NOT NULL CHECK (kind IN ('streak')),
  wanted  INTEGER NOT NULL CHECK (wanted IN (0, 1)),
  PRIMARY KEY (user_id, kind)
) STRICT, WITHOUT ROWID;

-- The mails sent when a player's streak ended, one row each, written before the mail is queued: one a player in 30
-- days at most, never two for a restart; and read back on the admin page (who came back within 3 days).
CREATE TABLE streak_mails (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day     TEXT    NOT NULL, -- YYYY-MM-DD, in Bulgaria
  at      INTEGER NOT NULL, -- when, in ms
  PRIMARY KEY (user_id, day)
) STRICT, WITHOUT ROWID;
