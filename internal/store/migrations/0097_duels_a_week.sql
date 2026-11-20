-- A friend has seven days to play a duel sent to them (the owner's call, 2026-11-20: DECISIONS.md „The direction“;
-- play.DuelFor). The duels sent already and still open get the same: a week from when they were sent.
UPDATE duels SET expires_at = sent_at + 7 * 24 * 3600 * 1000
WHERE kind = 'person' AND sent_at IS NOT NULL AND ended_at IS NULL AND expires_at < sent_at + 7 * 24 * 3600 * 1000;
