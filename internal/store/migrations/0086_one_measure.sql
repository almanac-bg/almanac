-- One measure of progress (the owner's call, 20 Nov 2026: DECISIONS.md „The redesign“): the Алманах and the streak.
-- XP and levels, the day's goals, achievements, titles and the wardrobe's unlocks (frames, patterns, emblem avatars)
-- are gone, with what was kept of telling them (the level seen, the unlocks told, the systems met, the peak the
-- division news was told by). The milestones that stay are notes in the player's book (play/progress.go), each once:
-- those already reached come from the achievements that marked them (a streak of 7, 30, 100, 365 days; the first day's
-- ten all right), on the day they were earned, as told. A player wearing an emblem (or the crown) wears the avatar the
-- game gives again; every animal is free, in any tone.
-- drops: achievements, unlocks_told, goals_done, goals_done_day, day_goals, runs.xp, users.title, users.frame
-- drops: users.backdrop, users.level_seen, users.unlocks_known, users.systems_told, users.peak, users.peak_seen
CREATE TABLE notes (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day     TEXT    NOT NULL, -- YYYY-MM-DD, in Bulgaria: the day it came
  kind    TEXT    NOT NULL CHECK (kind IN ('streak', 'perfect', 'chapter')),
  n       INTEGER NOT NULL DEFAULT 0, -- a streak's days
  topic   TEXT    NOT NULL DEFAULT '', -- a chapter's topic
  told    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind, n, topic)
) STRICT, WITHOUT ROWID;

INSERT OR IGNORE INTO notes (user_id, day, kind, n, topic, told)
SELECT user_id,
  date(at / 1000 + CASE WHEN CAST(strftime('%m', at / 1000, 'unixepoch') AS INT) BETWEEN 4 AND 10
    THEN 10800 ELSE 7200 END, 'unixepoch'),
  CASE id WHEN 'perfect' THEN 'perfect' ELSE 'streak' END,
  CASE id WHEN 'streak7' THEN 7 WHEN 'streak30' THEN 30 WHEN 'streak100' THEN 100 WHEN 'streak365' THEN 365 ELSE 0 END,
  '', 1
FROM achievements WHERE id IN ('streak7', 'streak30', 'streak100', 'streak365', 'perfect');

UPDATE users SET avatar = NULL WHERE avatar IS NOT NULL AND substr(avatar, 1, instr(avatar, '-') - 1) NOT IN
  ('fox', 'bear', 'cat', 'hare', 'hedgehog', 'dog', 'deer', 'stork', 'frog', 'mouse', 'squirrel', 'sheep', 'turtle',
   'badger', 'lynx');

DROP TABLE achievements;
DROP TABLE unlocks_told;
DROP TABLE goals_done;
DROP TABLE day_goals;

DROP INDEX runs_user;
ALTER TABLE runs DROP COLUMN xp;
CREATE INDEX runs_user ON runs (user_id, started_at, at, finished_at, told);

ALTER TABLE users DROP COLUMN title;
ALTER TABLE users DROP COLUMN frame;
ALTER TABLE users DROP COLUMN backdrop;
ALTER TABLE users DROP COLUMN level_seen;
ALTER TABLE users DROP COLUMN unlocks_known;
ALTER TABLE users DROP COLUMN systems_told;
ALTER TABLE users DROP COLUMN peak;
ALTER TABLE users DROP COLUMN peak_seen;
