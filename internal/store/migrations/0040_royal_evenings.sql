-- The evenings Роял was held (its start came with the server up), whether anyone came or not: their turnout decides
-- how often it plays (play.RoyalPaceOf). Those played so far, from their tournaments.
CREATE TABLE royal_evenings (day TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT OR IGNORE INTO royal_evenings (day) SELECT DISTINCT day FROM royals WHERE day IS NOT NULL AND starts_at IS NOT NULL;
