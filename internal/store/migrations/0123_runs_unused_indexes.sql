-- Three indexes of runs that no query of the game uses (audit 2026-11-24, Н8), each kept up with every game started,
-- answered and finished: runs_recordings served the recordings, gone since 0117; runs_finished and runs_shadow have no
-- query left that picks them. Checked by planning every statement the tests and a seeded server make (EXPLAIN QUERY
-- PLAN, with the seed's statistics too): what reads runs by player, or by when it ended, goes by runs_user.
-- drops: runs_recordings, runs_finished, runs_shadow
DROP INDEX runs_recordings;
DROP INDEX runs_finished;
DROP INDEX runs_shadow;
