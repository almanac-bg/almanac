-- The streak forgives one missed day a week by itself (the owner's call, 20 Nov 2026: DECISIONS.md „The redesign“);
-- reserve days, earned and held, are gone. So that the change keeps every streak that was going and wins back none
-- that had ended, each day missed in a streak before today is kept as the reserve days judged it (play/runs.go,
-- streak_missed): kept (a reserve day spent) or not (the streak ended there). The walk below is the old one
-- (play.walkStreak as it was): a reserve day on the first day ever played, every seventh day in a row and a day with
-- all three of the day's goals done, two in hand at most; from 2026-11-19 none before a streak's third day (which
-- earns the first), and one a week at most. A day missed spends one, or, with none, ends the streak.
-- Notices of a kept day are said of a forgiven one now.
CREATE TABLE streak_missed (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day     TEXT    NOT NULL,
  kept    INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
) STRICT, WITHOUT ROWID;

WITH RECURSIVE
  played (user_id, day) AS (
    SELECT DISTINCT user_id, day FROM runs WHERE kind = 'day' AND finished_at IS NOT NULL AND day IS NOT NULL),
  full_days (user_id, day) AS (SELECT user_id, day FROM goals_done GROUP BY user_id, day HAVING count(*) >= 3),
  firsts (user_id, day) AS (SELECT user_id, min(day) FROM played GROUP BY user_id),
  -- Today in Bulgaria (winter: UTC+2); the walk judges the days before it.
  today (day) AS (SELECT date('now', '+2 hours')),
  calendar (day) AS (
    SELECT min(day) FROM firsts
    UNION ALL SELECT date(day, '+1 day') FROM calendar WHERE date(day, '+1 day') < (SELECT day FROM today)),
  days (user_id, day, is_played, is_full) AS (
    SELECT f.user_id, c.day,
      EXISTS (SELECT 1 FROM played p WHERE p.user_id = f.user_id AND p.day = c.day),
      EXISTS (SELECT 1 FROM full_days x WHERE x.user_id = f.user_id AND x.day = c.day)
    FROM firsts f JOIN calendar c ON c.day >= f.day),
  -- The state after each day: the streak's days, the reserve days in hand, the Monday of the week the last was
  -- earned in, and whether the day was missed in a streak (kept or not).
  walk (user_id, day, streak, reserve, earned, missed, kept) AS (
    SELECT user_id, day, 1, CASE WHEN day < '2026-11-19' THEN 1 ELSE 0 END,
      CASE WHEN day < '2026-11-19' THEN date(day, 'weekday 0', '-6 days') END, 0, 0
    FROM firsts
    UNION ALL
    SELECT w.user_id, d.day,
      CASE WHEN d.is_played THEN w.streak + 1 WHEN w.streak > 0 AND w.reserve > 0 THEN w.streak ELSE 0 END,
      CASE WHEN d.is_played THEN w.reserve + (w.reserve < 2 AND (CASE WHEN d.day < '2026-11-19'
          THEN (w.streak + 1) % 7 = 0 OR d.is_full
          ELSE w.streak + 1 >= 3 AND (w.streak + 1 = 3 OR (w.streak + 1) % 7 = 0 OR d.is_full)
            AND coalesce(w.earned, '') <> date(d.day, 'weekday 0', '-6 days') END))
        WHEN w.streak > 0 AND w.reserve > 0 THEN w.reserve - 1 ELSE w.reserve END,
      CASE WHEN d.is_played AND w.reserve < 2 AND (CASE WHEN d.day < '2026-11-19'
          THEN (w.streak + 1) % 7 = 0 OR d.is_full
          ELSE w.streak + 1 >= 3 AND (w.streak + 1 = 3 OR (w.streak + 1) % 7 = 0 OR d.is_full)
            AND coalesce(w.earned, '') <> date(d.day, 'weekday 0', '-6 days') END)
        THEN date(d.day, 'weekday 0', '-6 days') ELSE w.earned END,
      NOT d.is_played AND w.streak > 0,
      NOT d.is_played AND w.streak > 0 AND w.reserve > 0
    FROM walk w JOIN days d ON d.user_id = w.user_id AND d.day = date(w.day, '+1 day'))
INSERT INTO streak_missed (user_id, day, kept)
SELECT user_id, day, kept FROM walk WHERE missed;

UPDATE users SET streak_told = 'forgiven:' || substr(streak_told, 6) WHERE streak_told LIKE 'kept:%';
