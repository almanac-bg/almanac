-- A friend request by email that its address's owner said no to: gone from their list, and still waiting in its
-- sender's until it runs out (account.EmailRequestDays), so that a no tells nobody the address has a player
-- (play.Withdraw).
ALTER TABLE friend_requests ADD COLUMN declined INTEGER NOT NULL DEFAULT 0;
