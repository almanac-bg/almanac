-- Fair play (play/fair.go, review 2026-11-18 S4, S20).
--
-- The network each game was started from: a keyed hash of it (server/address.go, netMark), never the address, kept
-- for NetsKept and then let go. Two players' games from one network close together move no rating between them, and
-- several throwaway guests' days from one network before a player's own are what JudgeNets looks for.
CREATE TABLE run_nets (
  run_id INTEGER PRIMARY KEY REFERENCES runs (id) ON DELETE CASCADE,
  net    BLOB    NOT NULL,
  at     INTEGER NOT NULL
) STRICT;
CREATE INDEX run_nets_net ON run_nets (net, at);
CREATE INDEX run_nets_at ON run_nets (at);

-- Why a duel with a result moved no rating (rated = 0), for the player to be told the true reason: again (the two had
-- a rated duel that day), recordings (past the day's rated duels against recordings), network (the two play from one
-- network), newcomers (past the day's rated duels against new players), known (a challenge drawn for the pair that
-- someone else had played first). And which of its sides was new to rated duels as it ended (play.Newcomer): a duel
-- against a new player moves an established one's rating half as far, NewcomersRatedPerDay times a day.
ALTER TABLE duels ADD COLUMN unrated TEXT CHECK (unrated IN ('again', 'recordings', 'network', 'newcomers', 'known'));
ALTER TABLE duels ADD COLUMN a_new INTEGER NOT NULL DEFAULT 0;
ALTER TABLE duels ADD COLUMN b_new INTEGER NOT NULL DEFAULT 0;
-- Those before had two reasons only.
UPDATE duels SET unrated = CASE WHEN kind = 'live' AND ghost_run IS NOT NULL THEN 'recordings' ELSE 'again' END
  WHERE rated = 0 AND outcome IN ('a', 'b', 'draw', 'ghost_won', 'ghost_lost', 'ghost_draw');

-- A player's day played after several throwaway guests had played it from the same network (JudgeNets), for /admin:
-- how many guests, and the best of their right answers.
CREATE TABLE fair_signals (
  run_id INTEGER PRIMARY KEY REFERENCES runs (id) ON DELETE CASCADE,
  day    TEXT    NOT NULL,
  guests INTEGER NOT NULL,
  best   INTEGER NOT NULL,
  at     INTEGER NOT NULL
) STRICT;
CREATE INDEX fair_signals_at ON fair_signals (at);
