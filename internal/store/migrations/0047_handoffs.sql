-- A link that carries a player's game to another browser on the phone, once (account.Handoff): from an app's own
-- browser (Messenger, Instagram …), where a guest's game would stay, to the phone's browser.
CREATE TABLE handoffs (
  token_hash BLOB    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX handoffs_user ON handoffs (user_id);
