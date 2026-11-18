-- A run that counts for its player alone is a shadow (play/fair.go), and there are two reasons for one now: played at
-- a script's speed (1), or a day's run a guest brought to an account that was there when it was played (2:
-- play/merge.go), so that signing in from the best of several guests' days doesn't make the day's one game a best of
-- many. The column was named for the first reason alone.
-- drops: runs.scripted, runs_scripted
ALTER TABLE runs RENAME COLUMN scripted TO shadow;
DROP INDEX runs_scripted;
CREATE INDEX runs_shadow ON runs (user_id) WHERE shadow;
