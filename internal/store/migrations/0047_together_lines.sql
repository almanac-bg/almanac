-- Of two friends, the one who asked (the owner of the invite link the other opened, or the sender of the request the
-- other accepted): they're told once on Начало that the other said yes (play.AcceptedOf).
ALTER TABLE friends ADD COLUMN asked INTEGER NOT NULL DEFAULT 0;
-- In a live duel, how many questions a player had played when they left it for good (it went on without them): said
-- on its result, and to the one who left, on Начало (play.LeftOf).
ALTER TABLE duels ADD COLUMN a_left INTEGER;
ALTER TABLE duels ADD COLUMN b_left INTEGER;
-- The lines a player has been told once on Начало, by what each is ("friend:12": a friend said yes; "left:345": what
-- came of a live duel they left).
CREATE TABLE home_lines (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  what    TEXT    NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, what)
) STRICT, WITHOUT ROWID;
