-- Every column that points to a player or a game has an index that starts with it (store's TestForeignKeysIndexed),
-- so that deleting a player (an account closed, the hourly clean-up of guests), a guest's games joining an account
-- (play.Merge) or a game deleted finds what points to it by the index, not by reading the whole table in the one
-- write transaction.
CREATE INDEX league_members_user ON league_members (user_id);
CREATE INDEX royal_players_run ON royal_players (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX reports_user ON reports (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX challenges_for ON challenges (for_id) WHERE for_id IS NOT NULL;
-- The two unique ones on from_id are each of some requests only (to a player, or to an email), so neither finds all
-- of a player's.
CREATE INDEX friend_requests_from ON friend_requests (from_id);

-- runs_opponent began with user_id, which nothing looks a duel's opponent up by: it's by opponent_id.
DROP INDEX runs_opponent;
CREATE INDEX runs_opponent ON runs (opponent_id) WHERE opponent_id IS NOT NULL;

-- The rating's board (play.RatingBoard): those on it, best first. 10 is play.MinRatedGames, written out as the
-- board's query writes it (an index of some rows is used only for a query that says the same of them).
CREATE INDEX users_rated ON users (rating DESC, rated DESC) WHERE rated >= 10;
