-- Each side's rating right after a duel moved it (null: it didn't, or it was settled before this was kept): a duel's
-- result shows where the rating went, from and to, however it has moved since.
ALTER TABLE duels ADD COLUMN a_rating INTEGER;
ALTER TABLE duels ADD COLUMN b_rating INTEGER;
