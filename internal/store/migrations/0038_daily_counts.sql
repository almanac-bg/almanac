-- What the admin page counts that no other table keeps (play/measure.go): a number a day for each thing counted — a
-- visit without a profile by where it landed, a share of the day, an answer to the reminder's ask, a notification sent
-- or opened. Nobody is in it: only how many.
CREATE TABLE daily_counts (
  day TEXT    NOT NULL, -- YYYY-MM-DD, in Bulgaria
  key TEXT    NOT NULL,
  n   INTEGER NOT NULL,
  PRIMARY KEY (day, key)
) STRICT, WITHOUT ROWID;

-- Where a player first came in, as the guest was made (play.Landings): the front page, a shared day, an invite, a
-- room, a player's page, the app. NULL: not known (an account made with an email, or a player from before).
ALTER TABLE users ADD COLUMN came_from TEXT;
