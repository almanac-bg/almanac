-- A duel against a recording names its player by the animal they started as, never by their name (play.RecordedAs:
-- account.AnimalOf, the id's place among the nine animals, in this order). The duels played before keep that name too.
-- A recording whose player has gone keeps none (play.Forget), as before.
UPDATE runs SET opponent = (
  SELECT CASE g.user_id % 9
    WHEN 0 THEN 'Лисица' WHEN 1 THEN 'Мечка' WHEN 2 THEN 'Котка' WHEN 3 THEN 'Заек' WHEN 4 THEN 'Таралеж'
    WHEN 5 THEN 'Куче' WHEN 6 THEN 'Елен' WHEN 7 THEN 'Щъркел' ELSE 'Жаба' END
  FROM duels d JOIN runs g ON g.id = d.ghost_run
  WHERE d.a_run = runs.id AND d.challenge_id IS NULL)
WHERE recorded = 1 AND opponent IS NOT NULL;
