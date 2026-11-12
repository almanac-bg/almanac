-- Playing: the day's questions, runs through a set of questions, and every answer given.

-- A day's ten questions, the same for everyone: drawn once, the first time the day is asked for, and kept, so a later
-- change to the bank never changes a day already played. `questions` is JSON: [{"id": "his-012", "seed": 123}, …].
CREATE TABLE days (
  day       TEXT PRIMARY KEY, -- YYYY-MM-DD, in Bulgaria
  questions TEXT NOT NULL
) STRICT, WITHOUT ROWID;

-- One player going through a set of questions: the day's, a topic's, or a challenge's.
CREATE TABLE runs (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('day', 'topic', 'challenge')),
  day         TEXT,    -- the day's run: which day
  category    TEXT,    -- a topic's run: which topic ('' for all of them)
  challenge   TEXT,    -- a challenge's run: the challenge's code
  questions   TEXT    NOT NULL, -- JSON, as in days
  at          INTEGER NOT NULL DEFAULT 0, -- the question now (= how many are answered)
  shown_at    INTEGER, -- when the question now was shown; NULL while it isn't
  points      INTEGER NOT NULL DEFAULT 0,
  rights      INTEGER NOT NULL DEFAULT 0,
  ms          INTEGER NOT NULL DEFAULT 0, -- time spent answering, all questions together
  started_at  INTEGER NOT NULL,
  finished_at INTEGER
) STRICT;
CREATE UNIQUE INDEX runs_one_a_day ON runs (user_id, day) WHERE kind = 'day';
CREATE INDEX runs_board ON runs (day, points DESC, ms) WHERE kind = 'day' AND finished_at IS NOT NULL;
CREATE INDEX runs_user ON runs (user_id, started_at);
CREATE INDEX runs_challenge ON runs (challenge) WHERE challenge IS NOT NULL;

-- Every answer: what was given (in the bank's own terms, so it adds up across deals; `shown`: as the player saw it),
-- what it was worth, how long it took. NULL: no answer (the time ran out). The questions' statistics come from here.
CREATE TABLE answers (
  run_id      INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  n           INTEGER NOT NULL, -- the question's place in the run
  question_id TEXT    NOT NULL,
  given       TEXT,
  shown       TEXT,
  score       REAL    NOT NULL, -- 0…1
  points      INTEGER NOT NULL,
  is_right    INTEGER NOT NULL,
  ms          INTEGER NOT NULL,
  at          INTEGER NOT NULL,
  PRIMARY KEY (run_id, n)
) STRICT, WITHOUT ROWID;
CREATE INDEX answers_question ON answers (question_id);

-- A challenge: a link to the questions of a run, for anyone to play and compare.
CREATE TABLE challenges (
  code       TEXT    PRIMARY KEY,
  run_id     INTEGER NOT NULL UNIQUE REFERENCES runs (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
