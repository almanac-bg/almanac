import type { ModeId } from '@almanac/shared';
import { all, one, run, tx } from './db';

/**
 * Running totals beside the rows they count, so a profile, an achievement check after every match or the moderators'
 * flag list reads a row or two instead of a player's whole history:
 * - `mode_stats`: per player and mode, the matches played, first places, wins that counted, two-a-side team wins, and
 *   places against others (for the average);
 * - `answer_tallies`: per player, the medium and hard answers in the log (ANSWER_LOG_DAYS) and how many were right.
 *
 * They're added to as matches are settled (tallyMatchPlayer, recordAnswers) and taken from as old answers go
 * (pruneAnswers). A crash between a write and its tally can't happen (one transaction), and every such transaction
 * says where the rows stand then (markTallied: `tallied_to`); a clean stop does too (keepTallies). A start that finds
 * the rows where either mark says counts nothing again, a crash or not; only rows that moved past both (a release from
 * before the marks played or pruned in between, after a rollback) are counted again, all of them. It recounted after
 * every crash before, 4 s and more on a big history, with the site down meanwhile (the 31 October review, SERVER-3).
 */

/**
 * A person's row (mp) of a match (room_code: the match's) as a team win the tallies count: won, two a side or more,
 * and in a private room against at least one person. It reads the match's other rows — bots' among them — so it's
 * decided as the match is settled and kept on the row (match_players.team_win: history.ts prunes bots' rows later).
 */
export const TEAM_WIN = (roomCode: string) => `(mp.won IS 1 AND mp.team IS NOT NULL
  AND (SELECT COUNT(*) FROM match_players t WHERE t.match_id = mp.match_id AND t.team = mp.team) >= 2
  AND (SELECT COUNT(*) FROM match_players o WHERE o.match_id = mp.match_id AND o.team <> mp.team) >= 2
  AND (${roomCode} IS NULL OR EXISTS (
    SELECT 1 FROM match_players o WHERE o.match_id = mp.match_id AND o.is_bot = 0 AND o.team <> mp.team)))`;

/** Each match a player played (mp, with its match m), as it adds to their tally in that mode. */
const MODE_TALLY = `
  SELECT mp.user_id, m.mode, COUNT(*),
    SUM(mp.placement = 1 AND m.player_count > 1 AND mp.left_match = 0),
    SUM(mp.won IS 1),
    -- Kept on the row since v43; a row from before (still being filled in: history.ts) works it out.
    SUM(COALESCE(mp.team_win, ${TEAM_WIN('m.room_code')})),
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

/**
 * Where the rows the tallies count stand: the last match settled, the last answer logged and the oldest kept (each an
 * index's end, so cheap at any size). Anything that plays or prunes moves one of them.
 */
function rowsMark(): string {
  const r = one<{ ended: number | null; logged: number | null; oldest: number | null }>(
    `SELECT (SELECT MAX(ended_at) FROM matches) AS ended, (SELECT MAX(rowid) FROM answers) AS logged,
       (SELECT MIN(answered_at) FROM answers) AS oldest`,
  )!;
  return `${r.ended ?? 0}:${r.logged ?? 0}:${r.oldest ?? 0}`;
}

/**
 * The tallies are kept up to the rows as they stand: called at the end of every transaction that settles a match,
 * prunes answers or erases an account (after its rows are in), so a crash right after leaves nothing to recount.
 */
export function markTallied() {
  run(
    "INSERT INTO settings (key, value) VALUES ('tallied_to', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    rowsMark(),
  );
}

/** Marks the tallies as kept up to now: at a clean stop, the only time nothing is half-way. */
export function keepTallies() {
  run(
    "INSERT INTO settings (key, value) VALUES ('tallies_kept', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    rowsMark(),
  );
}

/**
 * At the start: unless the last stop was this code's own clean one, the tallies are counted again from the rows (a
 * crash, or an older release that played matches and pruned answers without keeping them). The mark goes either way,
 * so a crash from here on is caught the same way.
 */
export function catchUpTallies(): boolean {
  const mark = one<{ value: string }>("SELECT value FROM settings WHERE key = 'tallies_kept'")?.value;
  const tallied = one<{ value: string }>("SELECT value FROM settings WHERE key = 'tallied_to'")?.value;
  const now = rowsMark();
  // Nothing to count on a new database either.
  const kept = mark === now || tallied === now || now === '0:0:0';
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
