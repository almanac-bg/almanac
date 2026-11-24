-- Which bank a kept count was counted for (its commit; '' if not known): a server that starts again on the same bank
-- takes the kept count up as its own, stale only by its age, instead of reading every answer again at every deploy
-- (play/snapshot.go).
ALTER TABLE counts ADD COLUMN bank TEXT NOT NULL DEFAULT '';
