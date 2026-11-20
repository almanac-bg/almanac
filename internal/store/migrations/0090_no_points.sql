-- No points (the owner's call, 2026-11-20: DECISIONS.md „The direction“): a game's score is its right answers, and a
-- close answer counts as not right. Between the same right answers a board, and a duel, go by how close the hard number
-- came (runs.closeness: its score, in thousandths), then by the hardest right answer (runs.hardest: a bit for each right
-- answer by its place, the tenth's the highest), then by time (play/board.go, tiebreak). The games played so far get
-- both from their answers: a number's is the answer given as one ({"value": …}); a question that counts for nobody
-- (play/day.go) is in neither.
-- drops: runs.points, answers.points
ALTER TABLE runs ADD COLUMN closeness INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN hardest INTEGER NOT NULL DEFAULT 0;

UPDATE runs SET
  closeness = coalesce((SELECT CAST(round(1000 * a.score) AS INTEGER) FROM answers a
    WHERE a.run_id = runs.id AND json_extract(a.given, '$.value') IS NOT NULL
      AND NOT coalesce(json_extract(runs.questions, '$[' || a.n || '].void'), 0)
    ORDER BY a.n DESC LIMIT 1), 0),
  hardest = coalesce((SELECT sum(1 << a.n) FROM answers a
    WHERE a.run_id = runs.id AND a.is_right AND a.n < 62
      AND NOT coalesce(json_extract(runs.questions, '$[' || a.n || '].void'), 0)), 0);

DROP INDEX runs_board;
ALTER TABLE runs DROP COLUMN points;
CREATE INDEX runs_board ON runs (day, rights DESC, closeness DESC, hardest DESC, ms)
  WHERE kind = 'day' AND finished_at IS NOT NULL;

ALTER TABLE answers DROP COLUMN points;
