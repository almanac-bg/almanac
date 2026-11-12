-- What players say is wrong with a question, until whoever keeps the bank has seen to it.
CREATE TABLE reports (
  id          INTEGER PRIMARY KEY,
  question_id TEXT    NOT NULL,
  user_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  text        TEXT    NOT NULL,
  at          INTEGER NOT NULL,
  resolved_at INTEGER
) STRICT;
CREATE INDEX reports_open ON reports (question_id) WHERE resolved_at IS NULL;
