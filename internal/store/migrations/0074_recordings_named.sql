-- A duel against a recording names its player as anyone is named (play/recordings.go, the owner's call of 2026-11-19):
-- the duels played before, kept by the animal its player started as (0061), take that player's name again. A recording
-- whose player has gone keeps none (play.Forget), as before.
UPDATE runs SET opponent = (
  SELECT u.name FROM duels d JOIN runs g ON g.id = d.ghost_run JOIN users u ON u.id = g.user_id
  WHERE d.a_run = runs.id AND d.challenge_id IS NULL)
WHERE recorded = 1 AND opponent IS NOT NULL;
