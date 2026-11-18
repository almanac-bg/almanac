-- A player blocks another (play/blocks.go): from then on the two are no friends, neither can ask the other to be
-- friends nor challenge them, and nothing of one reaches the other by a push. Only the one who blocked can lift it.
CREATE TABLE blocks (
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE, -- who blocked
  blocked_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  at         INTEGER NOT NULL,
  PRIMARY KEY (user_id, blocked_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX blocks_blocked ON blocks (blocked_id);

-- A player whoever keeps the game has suspended (/admin): their sessions end, and none starts again until it's lifted.
CREATE TABLE suspensions (
  user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  at      INTEGER NOT NULL
) STRICT;
