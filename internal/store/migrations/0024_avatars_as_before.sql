-- The avatars go back to the rules they had before the art grew (#234 changed them by mistake): nine animals free, an
-- achievement's family unlocking one emblem. The six animals added since go back to the one the game gives (NULL);
-- each emblem added since goes back to its family's (a torch to the flame, books to the book, and so on), tone kept.
UPDATE users
SET avatar = CASE substr(avatar, 1, instr(avatar, '-') - 1)
    WHEN 'torch' THEN 'flame'
    WHEN 'bonfire' THEN 'flame'
    WHEN 'phoenix' THEN 'flame'
    WHEN 'books' THEN 'book'
    WHEN 'blades' THEN 'shield'
    WHEN 'helmet' THEN 'shield'
    WHEN 'hearts' THEN 'heart'
    WHEN 'knight' THEN 'heart'
    WHEN 'cap' THEN 'trophy'
    WHEN 'wreath' THEN 'trophy'
  END || substr(avatar, instr(avatar, '-'))
WHERE instr(avatar, '-') > 0
  AND substr(avatar, 1, instr(avatar, '-') - 1) IN
    ('torch', 'bonfire', 'phoenix', 'books', 'blades', 'helmet', 'hearts', 'knight', 'cap', 'wreath');

UPDATE users
SET avatar = NULL
WHERE instr(avatar, '-') > 0
  AND substr(avatar, 1, instr(avatar, '-') - 1) IN ('squirrel', 'lynx', 'badger', 'sheep', 'turtle', 'mouse');
