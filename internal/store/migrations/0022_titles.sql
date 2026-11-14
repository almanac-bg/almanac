-- Titles are their own now, no longer an achievement's name: a few words for the player („Нощна птица“, „Желязна
-- воля“), each unlocked by an achievement, a level, a Роял won or a season's podium. A title worn keeps on as the
-- one its achievement now unlocks; one whose achievement unlocks none comes off. The podium's stay as they are.
UPDATE users SET title = CASE title
    WHEN 'fast' THEN 'lightning'
    WHEN 'perfect' THEN 'straightA'
    WHEN 'exact' THEN 'eagleEye'
    WHEN 'allTopics' THEN 'broadMind'
    WHEN 'friends5' THEN 'soul'
    WHEN 'nightOwl' THEN 'nightOwl'
    WHEN 'earlyBird' THEN 'earlyBird'
    WHEN 'lastSecond' THEN 'steelNerves'
    WHEN 'streak30' THEN 'ironWill'
    WHEN 'duel10' THEN 'toughNut'
    WHEN 'master' THEN 'brightMind'
    WHEN 'allTypes' THEN 'swissKnife'
    WHEN 'master5' THEN 'encyclopedia'
    WHEN 'duel50' THEN 'winMachine'
    WHEN 'streak100' THEN 'eternalFlame'
  END
WHERE title IS NOT NULL AND title NOT IN ('podium1', 'podium2', 'podium3');
