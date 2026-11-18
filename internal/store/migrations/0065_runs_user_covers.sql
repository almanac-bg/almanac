-- runs_user covers what's read of a player's games across all of them (a row of runs carries its questions, so
-- reading the rows costs far more than the index): the XP they've earned (xp: play/progress.go, xpOf), whether they've
-- moved since what's kept of them was worked out (count, id, at, finished_at: play/memo.go), and the game whose news
-- is untold (told: play/told.go). Made again with those columns after its own: what used it still does.
DROP INDEX runs_user;
CREATE INDEX runs_user ON runs (user_id, started_at, at, finished_at, xp, told);
