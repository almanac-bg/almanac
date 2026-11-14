-- A game played quicker than a person plays, a script's or a cheat's (play/fair.go): marked as its answers come in,
-- and left out of what the other players see (the day's board, the league, the questions' statistics, recordings).
ALTER TABLE runs ADD COLUMN scripted INTEGER NOT NULL DEFAULT 0;
CREATE INDEX runs_scripted ON runs (user_id) WHERE scripted;

-- The runs the bank is still to judge (play.JudgeRuns, as the server starts): whether an answer came under its
-- question's Floor depends on the question's kind, which only the bank knows. Listed here: the games played before the
-- mark with more than two answers (play.MostQuick) under two seconds, the highest Floor; no other can be a script's.
CREATE TABLE runs_unjudged (
  run_id INTEGER PRIMARY KEY REFERENCES runs (id) ON DELETE CASCADE
) STRICT;
INSERT INTO runs_unjudged (run_id)
  SELECT run_id FROM answers WHERE given IS NOT NULL AND ms < 2000 GROUP BY run_id HAVING count(*) > 2;
