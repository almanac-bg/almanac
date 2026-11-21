-- A player's invite link (play/invite.go; DECISIONS.md, the direction's people bullet, 21 Nov 2026): /f/<code>, one
-- per player, made the first time they ask for it, its code random and saying nothing of whose it is. Opened, it shows
-- who it is from; one tap makes the two friends. A new link takes the old one's place, which ends with it. day and
-- took count the friends the link has made on that day (play.InviteADay), kept over a new link, so that making one
-- gives no budget back.
CREATE TABLE invites (
  user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  code    TEXT    NOT NULL UNIQUE,
  made_at INTEGER NOT NULL,
  day     TEXT    NOT NULL DEFAULT '',
  took    INTEGER NOT NULL DEFAULT 0
) STRICT;
