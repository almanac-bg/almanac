-- Арена is out of the game: it needed three players online at once, which the game doesn't have, so it was a queue
-- that never filled. Its games and its achievement go with it (git has the code, should it come back).
DROP TABLE arena_players;
DROP TABLE arenas;
DELETE FROM achievements WHERE id = 'arenaWin';
DELETE FROM day_goals WHERE goal IN ('arena', 'arenaWin');
