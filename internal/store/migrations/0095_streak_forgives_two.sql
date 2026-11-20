-- The streak forgives up to two missed days a week (the owner's call, 2026-11-20: DECISIONS.md „The direction“), held
-- out at one for a tenth of the players who come in during its window (play/runs.go, StreakHoldout), with its own
-- salt: from its first whole day (tomorrow, in Bulgaria, as near as SQLite tells it) for eight weeks, the time a
-- change has to beat its hold-out. /admin tells it from then.
INSERT OR IGNORE INTO kv (key, value) VALUES
  ('streak_forgives_from', date('now', '+2 hours', '+1 day')),
  ('streak_forgives_until', date('now', '+2 hours', '+57 days'));
