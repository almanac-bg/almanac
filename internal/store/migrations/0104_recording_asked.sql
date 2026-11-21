-- A duel against a recording keeps the level the player asked for, „равен“ or „по-силен“, apart from the level met
-- (duels.level, none where the recording was only the nearest there was): „Още един дуел срещу запис“ asks for the
-- same again (play.DuelView.Asked). The duels before it asked for the level they met, as far as anyone knows.
ALTER TABLE duels ADD COLUMN asked TEXT CHECK (asked IN ('even', 'stronger'));
UPDATE duels SET asked = level WHERE kind = 'recording';
