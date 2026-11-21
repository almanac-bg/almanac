-- A handoff's link is a one-use token for half an hour, taken with a tap that names whose game it is
-- (account/handoff.go): no number to type, no network or system kept, nothing counted against it.
-- drops: handoffs.net, handoffs.os, handoffs.number, handoffs.misses, handoffs.copied
ALTER TABLE handoffs DROP COLUMN net;
ALTER TABLE handoffs DROP COLUMN os;
ALTER TABLE handoffs DROP COLUMN number;
ALTER TABLE handoffs DROP COLUMN misses;
ALTER TABLE handoffs DROP COLUMN copied;
