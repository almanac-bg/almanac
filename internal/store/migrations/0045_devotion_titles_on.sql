-- The level's titles past 16 name devotion too (play.Titles, after 0043): „Извор на знания“ (20), „Жива библиотека“
-- (30), „Вековна мъдрост“ (35) and „Пазител на знанието“ (40) become „Упоритост“, „Дълголетие“, „Издръжливост“ and
-- „Пазител на Алманаха“. Whoever wears an old one wears its level's new one.
UPDATE users SET title = CASE title
  WHEN 'well' THEN 'grit'
  WHEN 'library' THEN 'longevity'
  WHEN 'wisdom' THEN 'endurance' END
WHERE title IN ('well', 'library', 'wisdom');

-- What was told of the old ones is told of the new ones (play.Unlock's key holds the name): the same level unlocked
-- them, so the new names come with nothing to tell.
INSERT OR IGNORE INTO unlocks_told (user_id, id)
  SELECT user_id, CASE id
    WHEN 'title:well:Извор на знания' THEN 'title:grit:Упоритост'
    WHEN 'title:library:Жива библиотека' THEN 'title:longevity:Дълголетие'
    WHEN 'title:wisdom:Вековна мъдрост' THEN 'title:endurance:Издръжливост'
    WHEN 'title:keeper:Пазител на знанието' THEN 'title:keeper:Пазител на Алманаха' END
  FROM unlocks_told
  WHERE id IN ('title:well:Извор на знания', 'title:library:Жива библиотека', 'title:wisdom:Вековна мъдрост',
    'title:keeper:Пазител на знанието');
DELETE FROM unlocks_told
  WHERE id IN ('title:well:Извор на знания', 'title:library:Жива библиотека', 'title:wisdom:Вековна мъдрост',
    'title:keeper:Пазител на знанието');
