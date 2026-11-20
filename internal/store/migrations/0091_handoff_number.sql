-- A handoff's link keeps where it was made (account.Origin: a keyed hash of the network, never the address, and the
-- family of system) and the two-digit number its page shows: a browser elsewhere is asked for it, and a wrong one
-- counts (misses). The links made before go: each lives half an hour, and was made for a route that's gone.
DELETE FROM handoffs;
ALTER TABLE handoffs ADD COLUMN net BLOB;
ALTER TABLE handoffs ADD COLUMN os TEXT NOT NULL DEFAULT '';
ALTER TABLE handoffs ADD COLUMN number INTEGER NOT NULL DEFAULT 0;
ALTER TABLE handoffs ADD COLUMN misses INTEGER NOT NULL DEFAULT 0;
