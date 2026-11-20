-- A duel against a recording keeps the level it was chosen at, „равен“ or „по-силен“ (play.Even, play.Stronger), for
-- the duel to say which it is („По-силен запис · Краси“). A friend's duel has none, nor the recordings before it.
ALTER TABLE duels ADD COLUMN level TEXT CHECK (level IN ('even', 'stronger'));
