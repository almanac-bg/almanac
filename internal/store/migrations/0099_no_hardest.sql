-- A tie between the same right answers goes by how close the hard number came, then time (the Fable review, 20 Nov
-- 2026): the hardest right answer is no step of it any more, nor kept.
-- drops: runs.hardest
DROP INDEX runs_board;
ALTER TABLE runs DROP COLUMN hardest;
CREATE INDEX runs_board ON runs (day, rights DESC, closeness DESC, ms) WHERE kind = 'day' AND finished_at IS NOT NULL;
