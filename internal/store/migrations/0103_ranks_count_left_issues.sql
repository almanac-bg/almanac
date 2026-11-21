-- An issue left unfinished counts for the ranks once its day is over (play/ink.go: writtenIn); before, its ink never
-- did. The players with ink from one are counted again as the server starts (ranks_due, play.RanksDue), quietly; a
-- rank never falls.
INSERT OR IGNORE INTO ranks_due (user_id)
SELECT DISTINCT f.user_id FROM facts f JOIN runs r ON r.id = f.run_id
WHERE f.ink AND r.kind = 'day' AND r.finished_at IS NULL;
