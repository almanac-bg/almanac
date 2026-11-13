-- The wardrobe: a frame around the avatar and a pattern behind it, each unlocked by playing; and the highest rating a
-- player has reached (the divisions they've been in unlock some).
ALTER TABLE users ADD COLUMN frame TEXT;    -- play.Frames; NULL: none
ALTER TABLE users ADD COLUMN backdrop TEXT; -- play.Backdrops; NULL: plain
ALTER TABLE users ADD COLUMN peak INTEGER NOT NULL DEFAULT 1000;
UPDATE users SET peak = max(peak, rating);
