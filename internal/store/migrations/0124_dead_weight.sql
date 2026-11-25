-- The schema's dead weight (audit 2026-11-24, B3), in one migration:
--   - ranks.quarter (C-35): how far toward the next rank in quarters, written and compared, never read since the bar
--     took the quarters' place (#630).
--   - duels.questions (C-36): the picks as drawn, written once and never read (a duel's ten are its first run's,
--     versions and all), and a trap: they carry no versions.
--   - outbox.last_error (C-36): a failed send's error, written and never read (the log has it, the address hidden).
--   - today_lines (C-37): a table for one line, a friend's yes, told once; it's a mark on the asker's friendship now
--     (friends.told), which goes with the friendship: a yes after a friend removed and asked again is told again. A
--     line told after the friendship began is that friendship's, told.
--   - runs.shadow = 2 (C-25): a guest's day brought to an account, kept off friends' boards; that rule went in #763, so
--     those days are any day's again.
-- drops: ranks.quarter, duels.questions, outbox.last_error, today_lines
ALTER TABLE friends ADD COLUMN told INTEGER NOT NULL DEFAULT 0;
UPDATE friends SET told = 1 WHERE asked = 1 AND EXISTS (SELECT 1 FROM today_lines l
  WHERE l.user_id = friends.user_id AND l.what = 'friend:' || friends.friend_id AND l.at >= friends.since);
DROP TABLE today_lines;
ALTER TABLE ranks DROP COLUMN quarter;
ALTER TABLE duels DROP COLUMN questions;
ALTER TABLE outbox DROP COLUMN last_error;
UPDATE runs SET shadow = 0 WHERE shadow = 2;
