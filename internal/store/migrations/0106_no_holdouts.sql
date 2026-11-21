-- No hold-outs (2026-11-21): everyone gets two forgiven days a week, and the reminders they asked for. The windows
-- kept for them go, and so do the claims held out (never sent): a held one kept a day's reminder from coming, a held
-- streak's mail the next one for a month.
-- drops: push_reminded.held, streak_mails.held
DELETE FROM kv WHERE key IN ('streak_forgives_from', 'streak_forgives_until', 'reminders_from');
DELETE FROM push_reminded WHERE held;
DELETE FROM streak_mails WHERE held;
ALTER TABLE push_reminded DROP COLUMN held;
ALTER TABLE streak_mails DROP COLUMN held;
