-- /admin's numbers set right (the review of 0068's release).

-- users.first_version was stamped on any player's first answer of a day while it was empty, so every player from
-- before 0068 got the version of their next day. Only a player whose first day is the day 0068 first served or later
-- met a version (releases begins with that one; its day in Bulgaria, two hours ahead in November): the rest go back
-- to not known.
UPDATE users SET first_version = NULL
WHERE first_version IS NOT NULL
  AND (SELECT min(day) FROM active_days a WHERE a.user_id = users.id) <
    (SELECT date(min(at) / 1000, 'unixepoch', '+2 hours') FROM releases);

-- The reminders' hold-out (play/experiment.go) is told from its first whole day: the day after 0068 first served.
-- Before it, every reminder went, none was held, and the reminders of that day before the release went to all. A new
-- database has none of this: its hold-out is told from the start.
INSERT OR IGNORE INTO kv (key, value)
SELECT 'reminders_from', date(min(at) / 1000, 'unixepoch', '+2 hours', '+1 day') FROM releases HAVING count(*) > 0;

-- The day's reminder by mail, which the player asked for, is never held out (the owner, 2026-11-18): the claims held
-- so far go, so that today's mail still can.
-- drops: day_mails.held
DELETE FROM day_mails WHERE held;
ALTER TABLE day_mails DROP COLUMN held;
