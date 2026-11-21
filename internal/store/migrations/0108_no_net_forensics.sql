-- Fair play keeps its script's pace and its guests brought to an account, and nothing more (2026-11-21): the networks
-- games were started from, the days played after throwaway guests, and the answers taken late go. A throwaway guest's
-- day (shadow 3) was a person's own: it's on the boards again.
-- drops: run_nets, fair_signals, late_answers
UPDATE runs SET shadow = 0 WHERE shadow = 3;
DROP TABLE run_nets;
DROP TABLE fair_signals;
DROP TABLE late_answers;
