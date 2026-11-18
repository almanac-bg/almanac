-- The one week of the leagues raced on XP (0038, the week of 9 November 2026) has ended: every week since is raced on
-- the day's points, so the mark of it goes (play/leagues.go).
-- drops: league_week.on_xp
ALTER TABLE league_week DROP COLUMN on_xp;
