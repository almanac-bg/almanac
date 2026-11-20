-- Each emblem now comes with one achievement, its own picture (play.Achievements' Icon): the cup only with „Сто игри“,
-- no longer with „Майстор“ in a topic as well. Whoever wears the cup by „Майстор“ alone takes its own emblem, the
-- scholar's cap, tone kept. (The flame, the book, the shield and the heart stay with the first of their families,
-- which every later one follows.)
UPDATE users
SET avatar = 'cap' || substr(avatar, instr(avatar, '-'))
WHERE avatar LIKE 'trophy-%'
  AND NOT EXISTS (SELECT 1 FROM achievements a WHERE a.user_id = users.id AND a.id = 'games100')
  AND EXISTS (SELECT 1 FROM achievements a WHERE a.user_id = users.id AND a.id = 'master');
