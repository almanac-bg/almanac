-- Titles a player wears name the same for anyone (play.Titles): „Шампион на Рила“ becomes „Купата на Рила“ („Три купи
-- на Рила“ for three), „Пазител на Алманаха“ „Стълб на Алманаха“, „Летописец“ „Летопис на дните“; and two read as
-- translated: „Златен стандарт“ becomes „Чисто злато“, „Дуелен инстинкт“ „Инстинкт за победа“. Ids stay; what was told
-- of the old names is told of the new ones (play.Unlock's key), so nobody is told again of a title they have.
UPDATE OR IGNORE unlocks_told SET id = CASE id
    WHEN 'title:goldStandard:Златен стандарт' THEN 'title:goldStandard:Чисто злато'
    WHEN 'title:keeper:Пазител на Алманаха' THEN 'title:keeper:Стълб на Алманаха'
    WHEN 'title:chronicler:Летописец' THEN 'title:chronicler:Летопис на дните'
    WHEN 'title:duelInstinct:Дуелен инстинкт' THEN 'title:duelInstinct:Инстинкт за победа' END
  WHERE id IN ('title:goldStandard:Златен стандарт', 'title:keeper:Пазител на Алманаха', 'title:chronicler:Летописец',
    'title:duelInstinct:Дуелен инстинкт');

UPDATE OR IGNORE unlocks_told SET id =
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(id,
      'Двукратен шампион', 'Две купи'), 'Трикратен шампион', 'Три купи'), 'Четирикратен шампион', 'Четири купи'),
      'Петкратен шампион', 'Пет купи'), 'Шесткратен шампион', 'Шест купи'), 'Седемкратен шампион', 'Седем купи'),
      'Осемкратен шампион', 'Осем купи'), 'Деветкратен шампион', 'Девет купи'), 'Десеткратен шампион', 'Десет купи'),
      '-кратен шампион', ' купи'), 'Шампион', 'Купата')
  WHERE id LIKE 'title:champion:%';

-- A key left by UPDATE OR IGNORE had its new one told already.
DELETE FROM unlocks_told
  WHERE id IN ('title:goldStandard:Златен стандарт', 'title:keeper:Пазител на Алманаха', 'title:chronicler:Летописец',
    'title:duelInstinct:Дуелен инстинкт')
    OR (id LIKE 'title:champion:%' AND id LIKE '%ампион%');
