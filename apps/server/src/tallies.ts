import type { ModeId } from '@quiz/shared';
import { all, one, run, tx } from './db';

/**
 * Running totals beside the rows they count, so a profile, an achievement check after every match or the moderators'
 * flag list reads a row or two instead of a player's whole history:
 * - `mode_stats`: per player and mode, the matches played, first places, wins that counted, two-a-side team wins, and
 *   places against others (for the average);
 * - `answer_tallies`: per player, the medium and hard answers in the log (ANSWER_LOG_DAYS) and how many were right.
 *
 * They're added to as matches are settled (tallyMatchPlayer, recordAnswers) and taken from as old answers go
 * (pruneAnswers). Whatever ran without keeping them — a crash between a write and its tally can't happen (one
 * transaction), but a release from before them can, after a rollback — is caught at the next start: only a stop of
 * this code marks them as kept (keepTallies), and a start without that mark counts them again from the rows.
 */

/** Each match a player played (mp, with its match m), as it adds to their tally in that mode. */
const MODE_TALLY = `
  SELECT mp.user_id, m.mode, COUNT(*),
    SUM(mp.placement = 1 AND m.player_count > 1 AND mp.left_match = 0),
    SUM(mp.won IS 1),
    SUM(mp.won IS 1 AND mp.team IS NOT NULL
      AND (SELECT COUNT(*) FROM match_players t WHERE t.match_id = mp.match_id AND t.team = mp.team) >= 2
      AND (SELECT COUNT(*) FROM match_players o WHERE o.match_id = mp.match_id AND o.team <> mp.team) >= 2
      AND (m.room_code IS NULL OR EXISTS (
        SELECT 1 FROM match_players o WHERE o.match_id = mp.match_id AND o.is_bot = 0 AND o.team <> mp.team))),
    SUM(m.player_count > 1),
    SUM(CASE WHEN m.player_count > 1 THEN mp.placement ELSE 0 END)
  FROM match_players mp JOIN matches m ON m.id = mp.match_id`;
const MODE_COLUMNS = 'user_id, mode, games, firsts, wins, team_wins, placed, placements';

/** The answers the flag list looks at: a script reading answers off a copy of the bank shows on the harder ones. */
const ANSWER_TALLY = `SELECT user_id, COUNT(*), SUM(correct), MAX(answered_at) FROM answers WHERE difficulty <> 'easy'`;

/**
 * Adds a player's row of a settled match to their tally. Call once per person, after the match's rows are in and
 * their `won` is decided, and before their achievements are settled (those count this match).
 */
export function tallyMatchPlayer(matchId: string, playerId: string) {
  run(
    `INSERT INTO mode_stats (${MODE_COLUMNS})
     ${MODE_TALLY} WHERE mp.match_id = ? AND mp.player_id = ? AND mp.user_id IS NOT NULL GROUP BY m.mode
     ON CONFLICT (user_id, mode) DO UPDATE SET games = games + excluded.games, firsts = firsts + excluded.firsts,
       wins = wins + excluded.wins, team_wins = team_wins + excluded.team_wins, placed = placed + excluded.placed,
       placements = placements + excluded.placements`,
    matchId,
    playerId,
  );
}

/** An answer a person gave, as it adds to their tally (recordAnswers). */
export function tallyAnswer(userId: number, difficulty: string, correct: boolean, at: number) {
  if (difficulty === 'easy') return;
  run(
    `INSERT INTO answer_tallies (user_id, answered, correct, last_at) VALUES (?, 1, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET answered = answered + 1, correct = correct + excluded.correct,
       last_at = MAX(last_at, excluded.last_at)`,
    userId,
    correct ? 1 : 0,
    at,
  );
}

export interface ModeTally {
  mode: ModeId;
  games: number;
  /** First place in a match with others in it, played out: a profile's "wins". */
  firsts: number;
  /** Wins that counted (match_players.won): what achievements count. */
  wins: number;
  teamWins: number;
  /** Matches with others in them, and the places in them added up (an average place). */
  placed: number;
  placements: number;
}

export function modeTallies(userId: number): ModeTally[] {
  return all<ModeTally>(
    `SELECT mode, games, firsts, wins, team_wins AS teamWins, placed, placements FROM mode_stats WHERE user_id = ?`,
    userId,
  );
}

/** The flag list's candidates: who answered at least `minAnswers` harder questions, `minAccuracy` of them right. */
export function accurateAnswerers(minAnswers: number, minAccuracy: number, limit: number) {
  return all<{ user_id: number; n: number; hits: number; last_at: number }>(
    `SELECT user_id, answered AS n, correct AS hits, last_at FROM answer_tallies
     WHERE answered >= ? AND correct >= answered * ? ORDER BY correct * 1.0 / answered DESC, answered DESC LIMIT ?`,
    minAnswers,
    minAccuracy,
    limit,
  );
}

/** Marks the tallies as kept up to now: at a clean stop, the only time nothing is half-way. */
export function keepTallies() {
  run("INSERT INTO settings (key, value) VALUES ('tallies_kept', '1') ON CONFLICT (key) DO NOTHING");
}

/**
 * At the start: unless the last stop was this code's own clean one, the tallies are counted again from the rows (a
 * crash, or an older release that played matches and pruned answers without keeping them). The mark goes either way,
 * so a crash from here on is caught the same way.
 */
export function catchUpTallies(): boolean {
  const kept = !!one("SELECT 1 AS x FROM settings WHERE key = 'tallies_kept'");
  tx(() => {
    run("DELETE FROM settings WHERE key = 'tallies_kept'");
    if (kept) return;
    run('DELETE FROM mode_stats');
    run(
      `INSERT INTO mode_stats (${MODE_COLUMNS}) ${MODE_TALLY} WHERE mp.user_id IS NOT NULL GROUP BY mp.user_id, m.mode`,
    );
    run('DELETE FROM answer_tallies');
    run(`INSERT INTO answer_tallies (user_id, answered, correct, last_at) ${ANSWER_TALLY} GROUP BY user_id`);
  });
  return !kept;
}
