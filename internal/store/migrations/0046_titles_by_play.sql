-- A title is never one tap's luck nor the hour on the clock (play.Titles): „Нощна сова“ („След полунощ“) and
-- „Хладнокръвие“ („В последния миг“) go; those achievements give their avatar only. Whoever wears one wears their
-- level's title, as a player who hasn't chosen does (play.LevelTitle).
UPDATE users SET title = NULL WHERE title IN ('nightOwl', 'quietStrength');
DELETE FROM unlocks_told WHERE id LIKE 'title:nightOwl:%' OR id LIKE 'title:quietStrength:%';

-- „Под две секунди“ (one right answer under 2 s, common) is now „Пет за миг“ (play.FastRights right answers in one
-- game, each under play.FastMs: 5 and 3000 ms; rare), under the same id. Who earned the old one keeps it only by the
-- new rule, as play.measure counts it, with the rare tier's XP; the others lose it, and what it gave: the title
-- „Светкавица“ (speedDemon) and the avatar „Мълния“ (bolt), taken off if worn, and told again if earned anew.
CREATE TEMP TABLE fast_kept AS
  SELECT DISTINCT r.user_id FROM answers a JOIN runs r ON r.id = a.run_id
  WHERE r.user_id IN (SELECT user_id FROM achievements WHERE id = 'fast') AND a.is_right AND a.ms < 3000
  GROUP BY a.run_id HAVING count(*) >= 5;
DELETE FROM achievements WHERE id = 'fast' AND user_id NOT IN (SELECT user_id FROM fast_kept);
UPDATE achievements SET xp = 150 WHERE id = 'fast';
UPDATE users SET title = NULL WHERE title = 'speedDemon' AND id NOT IN (SELECT user_id FROM fast_kept);
UPDATE users SET avatar = NULL WHERE avatar LIKE 'bolt-%' AND id NOT IN (SELECT user_id FROM fast_kept);
DELETE FROM unlocks_told WHERE (id LIKE 'title:speedDemon:%' OR id LIKE 'avatar:bolt:%')
  AND user_id NOT IN (SELECT user_id FROM fast_kept);
DROP TABLE fast_kept;
