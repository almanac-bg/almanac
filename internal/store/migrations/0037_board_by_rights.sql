-- The day's board ranks by right answers first, then points, then time (play/board.go): its index follows.
DROP INDEX runs_board;
CREATE INDEX runs_board ON runs (day, rights DESC, points DESC, ms) WHERE kind = 'day' AND finished_at IS NOT NULL;
