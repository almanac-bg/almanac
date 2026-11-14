-- The game's own app on phones: each phone's token from its maker's push service (APNs on an iPhone, FCM on Android),
-- for its player, as push_subs keeps a browser's subscription.
CREATE TABLE phones (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform   TEXT    NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX phones_user ON phones (user_id);
