-- The days, in Bulgaria, each player played on: answered a question (any run) or played an Арена. Whether players
-- come back is counted from these (play.Retention, on the admin page). No foreign key: a guest cleaned up keeps their
-- days, or the players who never came back would drop out of the count and make it look better than it is.
CREATE TABLE active_days (
  user_id INTEGER NOT NULL,
  day     TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
) STRICT, WITHOUT ROWID;
CREATE INDEX active_days_day ON active_days (day, user_id);

-- The days played so far. All of them are since the rebuild, in winter time, when Bulgaria is UTC+2.
INSERT OR IGNORE INTO active_days (user_id, day)
  SELECT user_id, date(started_at / 1000, 'unixepoch', '+2 hours') FROM runs;
INSERT OR IGNORE INTO active_days (user_id, day)
  SELECT p.user_id, date(a.played_at / 1000, 'unixepoch', '+2 hours') FROM arena_players p JOIN arenas a ON a.id = p.arena_id;
