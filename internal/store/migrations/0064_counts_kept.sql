-- The last counts over everyone's answers (the questions' hardness and crowds, the boards of knowledge: play/snapshot.go),
-- kept so that a server that starts again takes them up at once, stale, and counts again in the background, instead of
-- making players wait for a full count after every deploy. What's in value is the count's own (gob); nothing else reads
-- it, and a row lost costs only one wait for a count.
CREATE TABLE counts (
  name  TEXT PRIMARY KEY,
  at    INTEGER NOT NULL, -- ms: when it was counted
  value BLOB    NOT NULL
) STRICT;
