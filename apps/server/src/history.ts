import { setImmediate as yieldToMatches } from 'node:timers/promises';
import { one, run, tx } from './db';
import { markTallied, TEAM_WIN } from './tallies';

/**
 * Match history kept within bounds (the 31 October review, SERVER-4, D7): bots' rows go after HISTORY.botDays — a Роял
 * wrote eight rows for one or two people, most of the database — and whole matches after HISTORY.matchDays. A profile
 * reads a person's last 20, the running tallies (mode_stats) keep the totals, and what they needed from the others'
 * rows is kept on each person's (team_win, filled in first for rows from before it). The privacy policy says so.
 */
export const HISTORY = { botDays: 30, matchDays: 730 } as const;

const DAY = 24 * 60 * 60_000;
/** Rows, or matches, a transaction at a time: the write lock is held for milliseconds, and matches play in between. */
const BATCH = 500;

/**
 * Rows from before team_win (v43) get it, while the match's other rows are still there to work it out from. Returns
 * how many are left (0: done; nothing of bots' may go before).
 */
export async function settleTeamWins(): Promise<number> {
  for (;;) {
    const { changes } = tx(() =>
      run(
        `UPDATE match_players AS mp SET team_win = ${TEAM_WIN('(SELECT room_code FROM matches WHERE id = mp.match_id)')}
         WHERE mp.rowid IN (SELECT rowid FROM match_players INDEXED BY match_players_team_unsettled
           WHERE team IS NOT NULL AND user_id IS NOT NULL AND team_win IS NULL LIMIT ?)`,
        BATCH,
      ),
    );
    if (Number(changes) < BATCH) break;
    await yieldToMatches();
  }
  return unsettled();
}

const unsettled = () =>
  one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM match_players INDEXED BY match_players_team_unsettled
     WHERE team IS NOT NULL AND user_id IS NOT NULL AND team_win IS NULL`,
  )!.n;

/** Bots' rows of matches over HISTORY.botDays ago, a batch of matches at a time, from where the last run stopped. */
async function pruneBotRows(now: number): Promise<number> {
  const before = now - HISTORY.botDays * DAY;
  let pruned = 0;
  for (;;) {
    const done = Number(one<{ value: string }>("SELECT value FROM settings WHERE key = 'bots_pruned_to'")?.value ?? 0);
    const batch = tx(() => {
      const last = one<{ ended: number | null; n: number }>(
        `SELECT MAX(ended_at) AS ended, COUNT(*) AS n FROM (
           SELECT ended_at FROM matches WHERE ended_at > ? AND ended_at < ? ORDER BY ended_at LIMIT ?)`,
        done,
        before,
        BATCH,
      )!;
      if (!last.n || last.ended === null) return { matches: 0, rows: 0 };
      const { changes } = run(
        `DELETE FROM match_players WHERE is_bot = 1 AND match_id IN (
           SELECT id FROM matches WHERE ended_at > ? AND ended_at <= ?)`,
        done,
        last.ended,
      );
      run(
        "INSERT INTO settings (key, value) VALUES ('bots_pruned_to', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        String(last.ended),
      );
      markTallied();
      return { matches: last.n, rows: Number(changes) };
    });
    pruned += batch.rows;
    if (batch.matches < BATCH) return pruned;
    await yieldToMatches();
  }
}

/** Whole matches over HISTORY.matchDays ago (their rows go with them: ON DELETE CASCADE), oldest first. */
async function pruneMatches(now: number): Promise<number> {
  const before = now - HISTORY.matchDays * DAY;
  let pruned = 0;
  for (;;) {
    const { changes } = tx(() => {
      const deleted = run(
        'DELETE FROM matches WHERE id IN (SELECT id FROM matches WHERE ended_at < ? ORDER BY ended_at LIMIT ?)',
        before,
        BATCH,
      );
      markTallied();
      return deleted;
    });
    pruned += Number(changes);
    if (Number(changes) < BATCH) return pruned;
    await yieldToMatches();
  }
}

/** The upkeep's step: team wins filled in first; bots' rows only once none is left to fill; then the oldest matches. */
export async function pruneHistory(now = Date.now()): Promise<{ bots: number; matches: number }> {
  const left = await settleTeamWins();
  const bots = left === 0 ? await pruneBotRows(now) : 0;
  const matches = await pruneMatches(now);
  return { bots, matches };
}
