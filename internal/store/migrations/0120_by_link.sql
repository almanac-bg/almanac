-- A friend request to whoever shared the day (the owner's call, 24 Nov 2026: DECISIONS.md, Friends and Sharing;
-- play/share.go, AskSharer): a stranger who played the day by a shared link asks its owner, without learning who it
-- is. A request made so says the issue whose link it came by (shown to the one asked: „по връзката ти от Брой 13“;
-- to its sender it names nobody), and a link counts the requests made by it, so that one posted in a crowd brings its
-- owner a few, not hundreds.
ALTER TABLE friend_requests ADD COLUMN via_issue INTEGER;
ALTER TABLE shares ADD COLUMN asked INTEGER NOT NULL DEFAULT 0;

-- How many new players a day came by a shared link (play/share.go, countByLink): a count a day, and nothing of who
-- (/admin's „Нови по връзка“).
CREATE TABLE new_by_link (
  day     TEXT    PRIMARY KEY, -- YYYY-MM-DD, the day of the player's first game
  players INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
