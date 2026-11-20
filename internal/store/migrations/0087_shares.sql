-- Sharing the day's result is back (the owner's call, 20 Nov 2026: DECISIONS.md „The redesign“): a player's finished
-- day gets a link of its own the first time it's shared (play/share.go), /d/<issue>-<code>. The code is all the link
-- holds; whose day it is stays with the run, and goes with it.
CREATE TABLE shares (
  code       TEXT    PRIMARY KEY, -- eight random letters and digits
  run_id     INTEGER NOT NULL UNIQUE REFERENCES runs (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
