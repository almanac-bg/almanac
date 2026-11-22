-- A duel is with a friend only, challenged directly from their row in Приятели or their profile (owner, 2026-11-22):
-- the duel against a recording of another's game is gone. Those played go (their runs stay the players' games, the
-- facts they met in grey), and a duel says no kind, nor the recording it was played against.
-- drops: duels.kind, duels.recording_run, duels_recording_run
DELETE FROM duels WHERE kind = 'recording';
DROP INDEX duels_recording_run;
ALTER TABLE duels DROP COLUMN recording_run;
ALTER TABLE duels DROP COLUMN kind;
