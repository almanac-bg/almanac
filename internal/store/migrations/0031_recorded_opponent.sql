-- A duel against a recording was against no player: it leaves the record between friends, their achievements and the
-- year's rival (settleDuel no longer writes it).
UPDATE runs SET opponent_id = NULL WHERE recorded = 1;
