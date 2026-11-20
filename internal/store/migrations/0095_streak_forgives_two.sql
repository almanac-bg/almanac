-- The streak forgives up to two missed days a week (the owner's call, 2026-11-20: DECISIONS.md „The direction“), held
-- out at one for a tenth of the players who come in during its window (play/runs.go, StreakHoldout), with its own
-- salt: from its first whole day (tomorrow, in Bulgaria: UTC+3 from April to October, UTC+2 the rest, as the other
-- migrations tell Bulgaria's day) for eight weeks, the time a change has to beat its hold-out; its measure, said in
-- advance, is the newcomers back on days 7 to 13 (/admin). If it shows no difference by then, two days stay.
INSERT OR IGNORE INTO kv (key, value)
SELECT 'streak_forgives_from', date(b, '+1 day') FROM (SELECT date(unixepoch() + CASE
  WHEN CAST(strftime('%m', 'now') AS INT) BETWEEN 4 AND 10 THEN 10800 ELSE 7200 END, 'unixepoch') AS b)
UNION ALL
SELECT 'streak_forgives_until', date(b, '+57 days') FROM (SELECT date(unixepoch() + CASE
  WHEN CAST(strftime('%m', 'now') AS INT) BETWEEN 4 AND 10 THEN 10800 ELSE 7200 END, 'unixepoch') AS b);
