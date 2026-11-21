-- What the direction audit (21 Nov 2026) found left over from points, races and tones, gone:
--   - An order is right or not (DECISIONS.md, „The direction“: „близо“ is the number's alone): the orders answered so
--     far are worth 1 or 0, as they're graded now, so that none reads as close anywhere (a recording's marks, a
--     day's tiles).
--   - A run keeps no time of its own (runs.ms: time never counts), nor the duel it was played in (runs.opponent,
--     opponent_id, recorded, outcome: the duel keeps its sides and its result, duels.outcome). The day's board
--     goes by right answers, then the hard number's closeness, never by time (play/board.go).
--   - A duel against a recording names it so (duels.recording_run, once ghost_run).
--   - An avatar is a shape alone (its tone gone with the edition: every animal in its own colours).
--   - What the player has been told on Днес is today_lines (once home_lines, from when the place was Начало).
-- drops: runs.ms, runs.opponent, runs.opponent_id, runs.recorded, runs.outcome, runs_opponent
-- drops: duels.ghost_run, duels_ghost_run, home_lines
UPDATE answers SET score = is_right WHERE json_extract(given, '$.order') IS NOT NULL AND score <> is_right;

DROP INDEX runs_board;
DROP INDEX runs_opponent;
ALTER TABLE runs DROP COLUMN ms;
ALTER TABLE runs DROP COLUMN opponent;
ALTER TABLE runs DROP COLUMN opponent_id;
ALTER TABLE runs DROP COLUMN recorded;
ALTER TABLE runs DROP COLUMN outcome;
CREATE INDEX runs_board ON runs (day, rights DESC, closeness DESC) WHERE kind = 'day' AND finished_at IS NOT NULL;

DROP INDEX duels_ghost_run;
ALTER TABLE duels RENAME COLUMN ghost_run TO recording_run;
CREATE INDEX duels_recording_run ON duels (recording_run) WHERE recording_run IS NOT NULL;

UPDATE users SET avatar = substr(avatar, 1, instr(avatar, '-') - 1) WHERE instr(avatar, '-') > 1;

ALTER TABLE home_lines RENAME TO today_lines;
