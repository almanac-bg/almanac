-- A title is never one tap's luck nor the hour on the clock (play.Titles): „Нощна сова“ („След полунощ“) and
-- „Хладнокръвие“ („В последния миг“) go; those achievements give their avatar only. Whoever wears one wears their
-- level's title, as a player who hasn't chosen does (play.LevelTitle).
UPDATE users SET title = NULL WHERE title IN ('nightOwl', 'quietStrength');
DELETE FROM unlocks_told WHERE id LIKE 'title:nightOwl:%' OR id LIKE 'title:quietStrength:%';
