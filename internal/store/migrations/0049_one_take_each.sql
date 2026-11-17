-- A challenge is played once by each taker (play.TakeChallenge): two tabs taking it at the same moment made two
-- games of it. Any second game already made goes (its run stays the taker's), then the rule holds.
DELETE FROM duels WHERE challenge_id IS NOT NULL AND id NOT IN (
  SELECT min(id) FROM duels WHERE challenge_id IS NOT NULL GROUP BY challenge_id, a_id
);
CREATE UNIQUE INDEX duels_taker ON duels (challenge_id, a_id) WHERE challenge_id IS NOT NULL;
