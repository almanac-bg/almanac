import { setImmediate as yieldToMatches } from 'node:timers/promises';
import type { CategoryChoice, ModeId, PowerupId } from '@quiz/shared';
import { run } from './db';
import type { AnswerLogEntry } from './game/Game';

/** How long a finished run is kept: a year of real play to draw opponents from (the privacy policy says so). */
export const RUN_KEEP_DAYS = 365;

/** One answer as a run keeps it: short keys, since a run holds ten or more. */
export interface RunAnswer {
  /** The question. */
  q: string;
  /** Its place in the match. */
  i: number;
  /** The option picked, as the bank orders them; null for no answer in time (or a number question). */
  c: number | null;
  /** On a number question: the number given (null: none in time). */
  g?: number | null;
  /** On an order question: the order given, as the bank orders the items (null: none in time). */
  o?: number[] | null;
  ok: 0 | 1;
  /** How long it took; null for no answer in time. */
  t: number | null;
  /** Points scored. */
  p: number;
  /** The коз played on it. */
  k: PowerupId | null;
  /** Right on "Втори шанс"'s second try. */
  r?: 1;
}

/**
 * Saves one person's finished match, question by question: which questions in what order, the option picked (as the
 * bank orders them, so any shuffle can replay it), how fast, what it scored and any коз. A match against the record of
 * a real player can be played from it later, and it says more about a question than right or wrong. Call inside the
 * match's transaction.
 */
export function recordRun(
  r: {
    matchId: string;
    userId: number;
    mode: ModeId;
    category: CategoryChoice;
    /** The player's rating in the mode as the match began (ranked matches). */
    rating: number | null;
    score: number;
    correct: number;
    log: AnswerLogEntry[];
  },
  at = Date.now(),
) {
  const answers: RunAnswer[] = r.log.map((a) => ({
    q: a.questionId,
    i: a.index,
    c: a.choice,
    ...(a.closeness !== null && { g: a.guess }),
    ...(a.placed !== null && { o: a.arranged }),
    ok: a.correct ? 1 : 0,
    t: a.timeMs,
    p: a.points,
    k: a.powerup,
    ...(a.retried && { r: 1 as const }),
  }));
  run(
    `INSERT INTO runs (match_id, user_id, mode, category, rating, score, correct, answers, played_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.matchId,
    r.userId,
    r.mode,
    r.category,
    r.rating,
    r.score,
    r.correct,
    JSON.stringify(answers),
    at,
  );
}

/** Runs dropped in one delete: a short one, so the matches going on don't wait on it. */
const PRUNE_BATCH = 2_000;

/** Drops runs older than RUN_KEEP_DAYS, a batch at a time until none are left. Returns how many went. */
export async function pruneRuns(now = Date.now()): Promise<number> {
  const before = now - RUN_KEEP_DAYS * 24 * 60 * 60_000;
  let pruned = 0;
  for (;;) {
    const { changes } = run(
      'DELETE FROM runs WHERE id IN (SELECT id FROM runs WHERE played_at < ? ORDER BY id LIMIT ?)',
      before,
      PRUNE_BATCH,
    );
    pruned += Number(changes);
    if (Number(changes) < PRUNE_BATCH) return pruned;
    await yieldToMatches();
  }
}
