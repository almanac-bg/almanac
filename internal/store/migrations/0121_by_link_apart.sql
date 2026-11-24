-- What 0120 began (a friend request to whoever shared the day, and the new players a shared link brings), made so it
-- gives nobody away and counts what it says (review of #723; play/share.go).
--
-- A request by a shared link stands apart from one by username: its sender may ask the same player both ways and has
-- two requests, whoever the link was; had they been one, asking a guessed username would have named the link's owner.
-- drops: shares.asked, new_by_link
DROP INDEX friend_requests_to_player;
CREATE UNIQUE INDEX friend_requests_to_player ON friend_requests (from_id, to_id)
  WHERE to_id IS NOT NULL AND via_issue IS NULL;
CREATE UNIQUE INDEX friend_requests_by_link ON friend_requests (from_id, to_id, via_issue) WHERE via_issue IS NOT NULL;

-- Who has asked by a link (AskSharer), each once: a request called off and made again takes no more of the link's
-- play.SharerAsks. In place of shares.asked, which counted every request made.
CREATE TABLE share_asks (
  code    TEXT    NOT NULL REFERENCES shares (code) ON DELETE CASCADE,
  from_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (code, from_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX share_asks_from ON share_asks (from_id);
ALTER TABLE shares DROP COLUMN asked;

-- A player's first game played on a page opened at someone's shared link (play/share.go, markByLink): /admin's „Нови
-- по връзка“ counts the new whose first game it still is as it draws, so that one who signs in to an older account,
-- and so isn't new, isn't counted. In place of new_by_link, a count a day that a sign-in couldn't take back.
CREATE TABLE runs_by_link (
  run_id INTEGER PRIMARY KEY REFERENCES runs (id) ON DELETE CASCADE
) STRICT;
DROP TABLE new_by_link;
