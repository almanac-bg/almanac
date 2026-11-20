-- rebuild: Роял is gone (the owner's call, 20 Nov 2026: DECISIONS.md, „The redesign“). The games played in it stay
-- their players' games, as games of „Микс“ (every topic at once), as rooms' became (0081): their answers stay, and
-- with them the facts a player collected, the questions they have seen (no game deals them again first), and what
-- the answers tell of each question. A run a cut left open (those cut answered on to the end, off the standings) ends
-- where it stopped, at its last answer; none is news to tell on Начало now (told). What only Роял had goes: the
-- tournaments and who played in them (their places, and what the places did to ratings: the ratings themselves stay
-- as they are), the evenings held, who said they'd come, the choice of Роял's notifications, those of it still queued
-- (with the ones asked for, which only Роял sent), and the counts of those notifications. Runs take no Роял's kind any
-- more, and the choices of notifications no Роял's. SQLite changes a CHECK only by rebuilding the table (store.go);
-- every column kept is copied, and the indexes are made again as they are now.
-- drops: royals, royal_players, royal_plans, royal_evenings
UPDATE runs SET finished_at = coalesce((SELECT max(a.at) FROM answers a WHERE a.run_id = runs.id), started_at),
    shown_at = NULL
  WHERE kind = 'royal' AND finished_at IS NULL;
DELETE FROM push_queue WHERE kind IN ('royal', '');
DELETE FROM daily_counts WHERE key GLOB 'push:*:royal' OR key GLOB 'push:*:asked';

DROP TABLE royal_players;
DROP TABLE royals;
DROP TABLE royal_plans;
DROP TABLE royal_evenings;

CREATE TABLE runs_new (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('day', 'topic', 'duel')),
  day         TEXT,
  category    TEXT,
  opponent    TEXT,
  recorded    INTEGER NOT NULL DEFAULT 0,
  outcome     TEXT CHECK (outcome IN ('won', 'lost', 'draw')),
  questions   TEXT    NOT NULL,
  at          INTEGER NOT NULL DEFAULT 0,
  shown_at    INTEGER,
  points      INTEGER NOT NULL DEFAULT 0,
  rights      INTEGER NOT NULL DEFAULT 0,
  ms          INTEGER NOT NULL DEFAULT 0,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  opponent_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  xp          INTEGER NOT NULL DEFAULT 0,
  shadow      INTEGER NOT NULL DEFAULT 0,
  told        INTEGER NOT NULL DEFAULT 0,
  device      TEXT CHECK (device IN ('phone', 'tablet', 'desktop'))
) STRICT;
INSERT INTO runs_new (id, user_id, kind, day, category, opponent, recorded, outcome, questions, at, shown_at, points,
    rights, ms, started_at, finished_at, opponent_id, xp, shadow, told, device)
  SELECT id, user_id, CASE kind WHEN 'royal' THEN 'topic' ELSE kind END, day,
    CASE kind WHEN 'royal' THEN 'mix' ELSE category END, opponent, recorded, outcome, questions, at, shown_at, points,
    rights, ms, started_at, finished_at, opponent_id, xp, shadow, CASE kind WHEN 'royal' THEN 1 ELSE told END, device
  FROM runs;
DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;
CREATE UNIQUE INDEX runs_one_a_day ON runs (user_id, day) WHERE kind = 'day';
CREATE INDEX runs_board ON runs (day, rights DESC, points DESC, ms) WHERE kind = 'day' AND finished_at IS NOT NULL;
CREATE INDEX runs_recordings ON runs (finished_at) WHERE kind IN ('topic', 'duel') AND finished_at IS NOT NULL;
CREATE INDEX runs_finished ON runs (finished_at, user_id) WHERE finished_at IS NOT NULL;
CREATE INDEX runs_opponent ON runs (opponent_id) WHERE opponent_id IS NOT NULL;
CREATE INDEX runs_shadow ON runs (user_id) WHERE shadow;
CREATE INDEX runs_user ON runs (user_id, started_at, at, finished_at, xp, told);

CREATE TABLE push_prefs_new (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind    TEXT    NOT NULL CHECK (kind IN ('day', 'friends')),
  wanted  INTEGER NOT NULL CHECK (wanted IN (0, 1)),
  PRIMARY KEY (user_id, kind)
) STRICT, WITHOUT ROWID;
INSERT INTO push_prefs_new (user_id, kind, wanted) SELECT user_id, kind, wanted FROM push_prefs WHERE kind <> 'royal';
DROP TABLE push_prefs;
ALTER TABLE push_prefs_new RENAME TO push_prefs;
