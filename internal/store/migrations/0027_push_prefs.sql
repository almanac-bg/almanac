-- Notifications by kind: each player chooses which they get (a kind with no row here is at its default, which the
-- server keeps: server.pushKinds). And the players who said they'd come to an evening's Роял, called when its lobby
-- opens.
CREATE TABLE push_prefs (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind    TEXT    NOT NULL CHECK (kind IN ('day', 'friends', 'royal')),
  wanted  INTEGER NOT NULL CHECK (wanted IN (0, 1)),
  PRIMARY KEY (user_id, kind)
) STRICT, WITHOUT ROWID;

CREATE TABLE royal_plans (
  day     TEXT    NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (day, user_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX royal_plans_user ON royal_plans (user_id);
