-- The lists migrations left for the server to work through as it started (the runs for the bank to judge, the ranks
-- to count) and the days missed as the reserve days had judged them: production has none of them left (2026-11-21).
-- drops: runs_unjudged, ranks_due, streak_missed
DROP TABLE runs_unjudged;
DROP TABLE ranks_due;
DROP TABLE streak_missed;
