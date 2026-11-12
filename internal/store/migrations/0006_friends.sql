-- Friends: two players who joined up through one's invite link. Kept both ways, so each side's list is one lookup.
ALTER TABLE users ADD COLUMN invite TEXT; -- the code of the player's own invite link, made when first asked for
CREATE UNIQUE INDEX users_invite ON users (invite) WHERE invite IS NOT NULL;

CREATE TABLE friends (
  user_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  since     INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX friends_friend ON friends (friend_id);

-- A duel's opponent when it was a player (not a recording): for the record between two friends.
ALTER TABLE runs ADD COLUMN opponent_id INTEGER REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX runs_opponent ON runs (user_id, opponent_id) WHERE opponent_id IS NOT NULL;
