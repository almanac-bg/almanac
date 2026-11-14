-- Роял is played live: every evening at 21:00, up to 50 players on the same question at the same moment. A
-- tournament keeps its evening and where its game is (the question now, and whether it's showing or its answer is),
-- so that a restart of the server picks the game up again. A player in its lobby has no run yet: runs are given at
-- the start, to those there.
ALTER TABLE royals ADD COLUMN day TEXT;
ALTER TABLE royals ADD COLUMN starts_at INTEGER;
ALTER TABLE royals ADD COLUMN n INTEGER NOT NULL DEFAULT 0;
ALTER TABLE royals ADD COLUMN phase TEXT NOT NULL DEFAULT 'end' CHECK (phase IN ('lobby', 'question', 'reveal', 'end'));
ALTER TABLE royals ADD COLUMN phase_at INTEGER;
CREATE INDEX royals_live ON royals (starts_at) WHERE ended_at IS NULL;
-- The tournaments played each in their own time end now: the next look for those due ends them with the places as
-- they stand.
UPDATE royals SET closes_at = 0 WHERE ended_at IS NULL;
