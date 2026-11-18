-- How many played a room's game (play/rooms.go, RecordRoom): those who gave an answer in it. A room's game counts for
-- the day's goals and the achievements of games only when someone else played it too, and for „Сто игри“ only with
-- ten questions or more (review 2026-11-18, E10): alone, on easy questions, it was a shortcut. NULL for any other
-- game, and for a room's game kept before this, unless its other players' games tell (room_game is `<game>:<player>`).
ALTER TABLE runs ADD COLUMN players INTEGER;
UPDATE runs SET players = (
  SELECT count(*) FROM runs o
  WHERE o.room_game IS NOT NULL
    AND substr(o.room_game, 1, instr(o.room_game, ':')) = substr(runs.room_game, 1, instr(runs.room_game, ':'))
)
WHERE kind = 'room' AND room_game IS NOT NULL AND instr(room_game, ':') > 0;
