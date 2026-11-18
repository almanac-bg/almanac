-- A room's game is kept once for each of its players (play/rooms.go, RecordRoom): a game whose end is played again
-- (a crash just after it, the room restored as it was saved before) finds the runs it was kept as. room_game is the
-- game's id with the player's (`<game>:<player>`), so that it stays one when a guest's runs move into an account.
ALTER TABLE runs ADD COLUMN room_game TEXT;
CREATE UNIQUE INDEX runs_room_game ON runs (room_game) WHERE room_game IS NOT NULL;
