-- Every version of every question the game has played (play/versions.go): a play is graded against the version it
-- showed, whatever the bank has become since, and a question's crowd and hardness count only the answers to the
-- version it is now. A version is what a question asks (bank.Version); its row keeps the question as it was.
CREATE TABLE question_versions (
  id          INTEGER PRIMARY KEY,
  question_id TEXT    NOT NULL,
  version     TEXT    NOT NULL, -- bank.Version
  category    TEXT    NOT NULL,
  body        TEXT    NOT NULL, -- the question, as bank.Encode wrote it
  -- When it came into play (ms). A question's first version kept: the start of the day it was last changed
  -- (bank.Tail.AskedSince), as its answers from before versions were kept are told apart by that alone.
  since       INTEGER NOT NULL,
  UNIQUE (question_id, version)
) STRICT;

-- The version each answer was to (question_versions.id); NULL for answers from before versions were kept.
ALTER TABLE answers ADD COLUMN version INTEGER;
