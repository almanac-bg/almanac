-- Notifications go out through a queue (server/pushes.go): each is saved first, one row a player, and sent by a pool
-- of workers, so that a restart loses none and no player waits behind another. A row leaves the queue once it's sent,
-- or can't be (no device for it, too late, its tries spent). While a try is under way, next_at is moved ahead (a
-- lease): a crash mid-send leaves the row to be tried again once it's over.
CREATE TABLE push_queue (
  id      INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind    TEXT    NOT NULL,          -- what the player chooses it by (push_prefs.kind); '' for one they asked for
  message TEXT    NOT NULL,          -- push.Message, JSON (a day's reminder: written as it's sent)
  day     TEXT,                      -- a day's reminder: its day (push_reminded), and not sent once it's played
  needs   TEXT,                      -- a part of the game the player must have met for it (play.Open), if any
  next_at INTEGER NOT NULL,          -- ms: not before
  until   INTEGER NOT NULL,          -- ms: of no use after
  tries   INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX push_queue_next ON push_queue (next_at);
CREATE INDEX push_queue_user ON push_queue (user_id);

-- How many of the player's devices a day's reminder reached: one that reached none counts neither as left unplayed
-- nor as the last (server/remind.go). Those sent before this was kept are taken as delivered.
ALTER TABLE push_reminded ADD COLUMN delivered INTEGER NOT NULL DEFAULT 1;

-- A browser or a phone whose service keeps refusing it: since when (ms), and how many tries. Forgotten once it has
-- refused long enough (server/pushes.go); a push it takes clears both.
ALTER TABLE push_subs ADD COLUMN failing_since INTEGER;
ALTER TABLE push_subs ADD COLUMN fails INTEGER NOT NULL DEFAULT 0;
ALTER TABLE phones ADD COLUMN failing_since INTEGER;
ALTER TABLE phones ADD COLUMN fails INTEGER NOT NULL DEFAULT 0;
