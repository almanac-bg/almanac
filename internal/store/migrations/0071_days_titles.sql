-- The titles that read as loyalty are no longer the level's but the days' (play/titles.go, review 2026-11-18, E8):
-- „Постоянство“ at 14 days on which the day's questions were played, up to „Жив алманах“ at 1000. A player who wore
-- one of them, by the level, without the days goes back to the level's own title (NULL: play.LevelTitle), and one who
-- was told of it as unlocked will be told again once the days unlock it.
WITH days_titles (id, days) AS (
  VALUES ('persistence', 14), ('devotion', 30), ('loyalty', 100), ('longevity', 200), ('keeper', 365),
    ('chronicler', 500), ('almanac', 1000)
)
UPDATE users SET title = NULL
WHERE title IN (SELECT id FROM days_titles)
  AND (SELECT days FROM days_titles WHERE id = users.title) >
    (SELECT count(*) FROM runs WHERE runs.user_id = users.id AND runs.kind = 'day' AND runs.finished_at IS NOT NULL);

WITH days_titles (key, days) AS (
  VALUES ('title:persistence:Постоянство', 14), ('title:devotion:Всеотдайност', 30),
    ('title:loyalty:Вярност към Алманаха', 100), ('title:longevity:Дълголетие', 200),
    ('title:keeper:Стълб на Алманаха', 365), ('title:chronicler:Летопис на дните', 500),
    ('title:almanac:Жив алманах', 1000)
)
DELETE FROM unlocks_told
WHERE id IN (SELECT key FROM days_titles)
  AND (SELECT days FROM days_titles WHERE key = unlocks_told.id) >
    (SELECT count(*) FROM runs WHERE runs.user_id = unlocks_told.user_id AND runs.kind = 'day'
      AND runs.finished_at IS NOT NULL);
