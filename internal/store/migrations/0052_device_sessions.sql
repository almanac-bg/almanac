-- A browser's notifications, and a phone's, belong to the session that turned them on (account: a session is one
-- browser's): when it ends (signing out, signing out the other devices, a handoff that moves the game away, a guest
-- becoming a profile), they end with it, whatever the device remembers. Each is tied to its session as it's told to
-- the server again (the app does at every start); those already kept are tied now where their player has one
-- session only, and the rest stay their player's until then.
ALTER TABLE push_subs ADD COLUMN session BLOB REFERENCES sessions (token_hash) ON DELETE CASCADE;
ALTER TABLE phones ADD COLUMN session BLOB REFERENCES sessions (token_hash) ON DELETE CASCADE;
CREATE INDEX push_subs_session ON push_subs (session);
CREATE INDEX phones_session ON phones (session);

UPDATE push_subs SET session = (SELECT token_hash FROM sessions s WHERE s.user_id = push_subs.user_id)
  WHERE (SELECT count(*) FROM sessions s WHERE s.user_id = push_subs.user_id) = 1;
UPDATE phones SET session = (SELECT token_hash FROM sessions s WHERE s.user_id = phones.user_id)
  WHERE (SELECT count(*) FROM sessions s WHERE s.user_id = phones.user_id) = 1;
