-- A duel against a recording is of one kind (owner, 2026-11-22: no „равен“ and „по-силен“ to choose between): the
-- recording nearest to the player (play.DuelRecording). So a duel keeps no level.
-- drops: duels.level
ALTER TABLE duels DROP COLUMN level;
