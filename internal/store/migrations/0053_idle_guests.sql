-- The guests who never played are cleared after a few days unseen (account.CleanUp, hourly): found by when they were
-- last seen, among guests only, not by reading every player.
CREATE INDEX users_guests_seen ON users (seen_at) WHERE email IS NULL;
