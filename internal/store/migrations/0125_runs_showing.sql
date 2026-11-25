-- The day's runs with a question showing, unfinished: what the minute's sweep reads to settle by their own clocks
-- (play.SettleLeft), so that a day whose tenth ran out with nobody there counts without waiting for a look. A few rows
-- at any moment: the players in the middle of a question, and those who left one.
CREATE INDEX runs_showing ON runs (shown_at) WHERE kind = 'day' AND finished_at IS NULL AND shown_at IS NOT NULL;
