-- When the player last looked at Приятели, on any device (ms; 0: never). Its dot is what has come there since: a
-- friend request, a duel sent to them, a result of one of their duels (play.FriendsNews); not what waits to be played
-- (owner, 2026-11-21).
ALTER TABLE users ADD COLUMN friends_seen_at INTEGER NOT NULL DEFAULT 0;
