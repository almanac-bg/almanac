-- What /admin needs to tell whether a change worked (review 2026-11-18, D3–D5).

-- The version of the game a player met: live when they first played (play.markActive). Goes with the player.
ALTER TABLE users ADD COLUMN first_version TEXT;

-- What a game was started on, as the server could tell from the request (server/address.go, clientDevice): none
-- where it couldn't (Роял, a room's game).
ALTER TABLE runs ADD COLUMN device TEXT CHECK (device IN ('phone', 'tablet', 'desktop', 'app-ios', 'app-android'));

-- The day's reminder (a notification or a mail) or a streak's mail that a player in the hold-out (play/experiment.go)
-- would have had, kept as if sent but never sent: the pair /admin compares.
ALTER TABLE push_reminded ADD COLUMN held INTEGER NOT NULL DEFAULT 0;
ALTER TABLE streak_mails ADD COLUMN held INTEGER NOT NULL DEFAULT 0;
ALTER TABLE day_mails ADD COLUMN held INTEGER NOT NULL DEFAULT 0;

-- Each version of the game, and when it first served: the marks on /admin's charts.
CREATE TABLE releases (
  version TEXT    PRIMARY KEY,
  at      INTEGER NOT NULL -- ms
) STRICT, WITHOUT ROWID;

-- A week's cohort's numbers, frozen once all of its players' days for a measure are over (server/measure.go): the
-- table on /admin stops changing after the fact (an account a guest signs in to, a rule read differently later). Totals
-- only, nobody's.
CREATE TABLE cohort_weeks (
  week    TEXT    NOT NULL, -- its Monday, YYYY-MM-DD
  measure TEXT    NOT NULL,
  n       INTEGER NOT NULL,
  total   INTEGER NOT NULL,
  PRIMARY KEY (week, measure)
) STRICT, WITHOUT ROWID;
