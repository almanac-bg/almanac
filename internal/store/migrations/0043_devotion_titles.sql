-- The level's titles name devotion, not intellect (play.Titles): „Ерудиция“, „Всезнание“, „Гениален ум“ and „Оракул“
-- (levels 8, 12, 16 and 25) become „Постоянство“, „Ненаситно любопитство“, „Всеотдайност“ and „Вярност към
-- Алманаха“. „Всезнание“ and „Оракул“ stay, as mastery's („Експерт“ in every topic, „Светило“ in three); „Гениален
-- ум“ goes. Whoever wears an old one wears its level's new one.
UPDATE users SET title = CASE title
  WHEN 'erudition' THEN 'persistence'
  WHEN 'omniscience' THEN 'insatiable'
  WHEN 'genius' THEN 'devotion'
  WHEN 'oracle' THEN 'loyalty' END
WHERE title IN ('erudition', 'omniscience', 'genius', 'oracle');

-- What was told of the old ones is told of the new ones (play.Unlock's key): the same level unlocked them, so the new
-- names come with nothing to tell; and the mastery titles, when they come, are told as new.
INSERT OR IGNORE INTO unlocks_told (user_id, id)
  SELECT user_id, CASE id
    WHEN 'title:erudition:Ерудиция' THEN 'title:persistence:Постоянство'
    WHEN 'title:omniscience:Всезнание' THEN 'title:insatiable:Ненаситно любопитство'
    WHEN 'title:genius:Гениален ум' THEN 'title:devotion:Всеотдайност'
    WHEN 'title:oracle:Оракул' THEN 'title:loyalty:Вярност към Алманаха' END
  FROM unlocks_told
  WHERE id IN ('title:erudition:Ерудиция', 'title:omniscience:Всезнание', 'title:genius:Гениален ум', 'title:oracle:Оракул');
DELETE FROM unlocks_told
  WHERE id IN ('title:erudition:Ерудиция', 'title:omniscience:Всезнание', 'title:genius:Гениален ум', 'title:oracle:Оракул');
