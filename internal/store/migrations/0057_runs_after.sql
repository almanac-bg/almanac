-- What a finished run still has to do after its last answer is kept (play/after.go): settle its duel, start a
-- challenge's time and tell the friends, and keep what it earned (a streak mended, achievements, goals, the league).
-- Written in the transaction that finishes the run, so that a closed connection or a restart can't lose it: the
-- request that finished the run does it at once, and the sweep each minute does what that left.
CREATE TABLE runs_after (
  run_id INTEGER PRIMARY KEY REFERENCES runs (id) ON DELETE CASCADE,
  due    INTEGER NOT NULL, -- ms: from when the sweep may take it (until then it's the finishing request's)
  tries  INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX runs_after_due ON runs_after (due);
