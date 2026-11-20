-- Ink and pencil (the owner's call, 2026-11-20: DECISIONS.md „The direction“; play/ink.go): every right answer writes
-- its question's fact in the player's book once. In ink: right in the day's issue, the first time the player met the
-- question (any answer, any game); else in pencil. A game at a script's speed (runs.shadow = 1) writes neither, nor
-- does a question that counts for nobody in its day. The books so far are written from the answers by the same rule
-- (play.factsRule, for every player at once).
CREATE TABLE facts (
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  question_id TEXT    NOT NULL,
  ink         INTEGER NOT NULL, -- 1: in ink; 0: in pencil
  at          INTEGER NOT NULL, -- when it was written: the right answer's moment (ms)
  run_id      INTEGER REFERENCES runs (id) ON DELETE SET NULL, -- the game that wrote it
  PRIMARY KEY (user_id, question_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX facts_run ON facts (run_id) WHERE run_id IS NOT NULL;

INSERT INTO facts (user_id, question_id, ink, at, run_id)
WITH met AS (
    SELECT r.user_id, a.question_id, min(a.at) AS at FROM answers a JOIN runs r ON r.id = a.run_id
    GROUP BY r.user_id, a.question_id),
  rights AS (
    SELECT r.user_id, a.question_id, a.at, a.run_id, r.kind = 'day' AND a.at = m.at AS ink
    FROM answers a JOIN runs r ON r.id = a.run_id
      JOIN met m ON m.user_id = r.user_id AND m.question_id = a.question_id
    WHERE a.is_right AND r.shadow <> 1 AND NOT coalesce(json_extract(r.questions, '$[' || a.n || '].void'), 0)),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY user_id, question_id ORDER BY ink DESC, at, run_id) AS k FROM rights)
SELECT user_id, question_id, ink, at, run_id FROM ranked WHERE k = 1;
