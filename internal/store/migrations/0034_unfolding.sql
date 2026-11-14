-- The game unfolds (play/unfold.go): a new player meets its systems one at a time, and each is told once as it opens.
-- systems_told are the ones a player has been told of, space-separated ("points xp league rating"). Whoever has played
-- already has seen the points, XP and the league from their first game, and the rating once a game has moved it.
ALTER TABLE users ADD COLUMN systems_told TEXT NOT NULL DEFAULT '';
UPDATE users SET systems_told = 'points xp league' || CASE WHEN rated > 0 THEN ' rating' ELSE '' END
  WHERE EXISTS (SELECT 1 FROM runs WHERE runs.user_id = users.id AND runs.finished_at IS NOT NULL);
