-- An answer the player's screen timed within its question's limit and that reached the server late, within
-- play.LateGrace, is taken; each is kept here a month for /admin, which counts them by player (play/late.go).
CREATE TABLE late_answers (
  run_id  INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  n       INTEGER NOT NULL,
  late_ms INTEGER NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (run_id, n)
) STRICT, WITHOUT ROWID;
CREATE INDEX late_answers_at ON late_answers (at);
