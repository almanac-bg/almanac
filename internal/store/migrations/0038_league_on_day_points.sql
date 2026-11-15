-- The weekly league races on the day's points (play/leagues.go): each player's points on the day's questions, added
-- up over the week, a day missed adding nothing; it no longer races on XP, which counts how much is played, not the
-- day. A player joins their group with their first finished run of the day's questions in a week.
--
-- The switch is made at a week's start, so that no week changes its rule half-way. The week of 9 November 2026 was
-- begun as a race on XP and ends as one (on_xp; the week after is on points). If this comes later, in a week begun
-- since, that week is on points from its Monday: the days already played count as they were played, and those it
-- seated by XP alone, without a run of the day's questions, leave the group until they play one.
ALTER TABLE league_week ADD COLUMN on_xp INTEGER NOT NULL DEFAULT 0;
UPDATE league_week SET on_xp = 1 WHERE id < '2026-11-16';

DELETE FROM league_members
WHERE week = (SELECT id FROM league_week WHERE NOT on_xp)
  AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.user_id = league_members.user_id AND r.kind = 'day'
    AND r.day >= league_members.week AND r.day < date(league_members.week, '+7 days') AND r.finished_at IS NOT NULL);
DELETE FROM league_groups
WHERE week = (SELECT id FROM league_week) AND id NOT IN (SELECT group_id FROM league_members);
