-- A player's face is their avatar alone (the owner, 2026-11-22): no seal on it, so none is worn, and the day a rank
-- rose to its level, kept only to choose between two best seals alike, goes.
-- drops: ranks.day
ALTER TABLE ranks DROP COLUMN day;
