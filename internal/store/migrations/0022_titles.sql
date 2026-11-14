-- Titles are their own now, no longer an achievement's name: a ladder by level („Нова искра“ … „Жив алманах“), some
-- achievements' („Демон на скоростта“), a topic's mastery („Майстор · История“) and the rating's. A title worn keeps
-- on as the one its achievement now unlocks; one whose achievement unlocks none comes off. The podium's stay.
UPDATE users SET title = CASE title
    WHEN 'fast' THEN 'speedDemon'
    WHEN 'streak7' THEN 'everyDay'
    WHEN 'perfect' THEN 'flawless'
    WHEN 'exact' THEN 'sharpEye'
    WHEN 'allTopics' THEN 'seeker'
    WHEN 'friends5' THEN 'heartOfGame'
    WHEN 'nightOwl' THEN 'nightOwl'
    WHEN 'lastSecond' THEN 'quietStrength'
    WHEN 'duel10' THEN 'duelInstinct'
    WHEN 'allTypes' THEN 'polymath'
    WHEN 'streak30' THEN 'unquenched'
    WHEN 'master5' THEN 'encyclopedia'
    WHEN 'duel50' THEN 'razor'
    WHEN 'streak100' THEN 'sunrises'
  END
WHERE title IS NOT NULL AND title NOT IN ('podium1', 'podium2', 'podium3');
