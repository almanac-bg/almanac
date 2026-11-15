-- The day's reminders, one row a player a day (server/remind.go): written before the reminder is sent, so that a
-- restart never sends two; and read back to stop reminding a player who doesn't come (and to tell, on the admin page,
-- who played within two hours of one). `last`: the one that said the reminders stop.
CREATE TABLE push_reminded (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day     TEXT    NOT NULL, -- YYYY-MM-DD, in Bulgaria
  at      INTEGER NOT NULL, -- when, in ms
  last    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
) STRICT, WITHOUT ROWID;
CREATE INDEX push_reminded_day ON push_reminded (day);

-- The one claim for everyone's evening that this replaces.
DELETE FROM kv WHERE key = 'reminded';
