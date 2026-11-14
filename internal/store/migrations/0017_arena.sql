-- Арена: 3 to 5 players matched at random, live, on the same questions; the most points win. Each game is kept with
-- every player's place, points and what it did to their rating.
CREATE TABLE arenas (
  id        INTEGER PRIMARY KEY,
  played_at INTEGER NOT NULL
) STRICT;

CREATE TABLE arena_players (
  arena_id INTEGER NOT NULL REFERENCES arenas (id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  place    INTEGER NOT NULL,
  points   INTEGER NOT NULL,
  rights   INTEGER NOT NULL,
  delta    INTEGER NOT NULL,
  PRIMARY KEY (arena_id, user_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX arena_players_user ON arena_players (user_id);
