import {
  type AlmanacCategoryPage,
  type AlmanacFact,
  type AlmanacOverview,
  CATEGORIES,
  type CategoryId,
  REVIEW,
  type ReviewQueue,
} from '@quiz/shared';
import { all, one, run } from './db';
import type { AnswerLogEntry } from './game/Game';
import { earnedMastery } from './mastery';
import {
  inPlay,
  numberBank,
  type PlayableQuestion,
  type PreparedQuestion,
  questionBank,
  reorderOptions,
} from './questions';

/**
 * „Моят алманах“: a question's "Знаеше ли?" becomes a player's once they get it right, or stop on it to read it in a
 * run played alone. Every question they get right is kept, fact or not: a fact written for it later is theirs too.
 * And „Поправителен“: each question they miss comes back REVIEW.afterDays later, until they've got it right at every
 * step.
 */

const DAY_MS = 24 * 60 * 60_000;

/** Facts there are to collect: questions in play with one, per category (worked out again when the bank changes). */
let totals: { bank: readonly unknown[]; numbers: readonly unknown[]; byCategory: Map<CategoryId, number> } | null =
  null;

function factTotals() {
  const bank = questionBank();
  const numbers = numberBank();
  if (totals?.bank !== bank || totals.numbers !== numbers) {
    const byCategory = new Map<CategoryId, number>();
    for (const q of [...bank, ...numbers])
      if (q.fact) byCategory.set(q.category, (byCategory.get(q.category) ?? 0) + 1);
    totals = { bank, numbers, byCategory };
  }
  return totals.byCategory;
}

/** Makes these questions the player's (the ones they didn't have); returns how many facts that added. */
export function learn(userId: number, questionIds: Iterable<string>, at = Date.now()): number {
  let added = 0;
  for (const id of new Set(questionIds)) {
    const { changes } = run(
      'INSERT OR IGNORE INTO learned (user_id, question_id, learned_at) VALUES (?, ?, ?)',
      userId,
      id,
      at,
    );
    if (Number(changes) && inPlay(id)?.fact) added++;
  }
  return added;
}

/** The player's facts, newest first: questions they've learned that are in play and have one now. */
function learnedFacts(userId: number): { q: PlayableQuestion; at: number }[] {
  const out: { q: PlayableQuestion; at: number }[] = [];
  for (const r of all<{ question_id: string; learned_at: number }>(
    'SELECT question_id, learned_at FROM learned WHERE user_id = ? ORDER BY learned_at DESC',
    userId,
  )) {
    const q = inPlay(r.question_id);
    if (q?.fact) out.push({ q, at: r.learned_at });
  }
  return out;
}

export const factCount = (userId: number) => learnedFacts(userId).length;

/** Facts that became the player's since then (a match's: read during it, or got right at its end). */
export const factsSince = (userId: number, since: number) =>
  all<{ question_id: string }>(
    'SELECT question_id FROM learned WHERE user_id = ? AND learned_at >= ?',
    userId,
    since,
  ).filter((r) => inPlay(r.question_id)?.fact).length;

/** Facts there are to collect in all. */
export const factsInAll = () => [...factTotals().values()].reduce((sum, n) => sum + n, 0);

function toFact(q: PlayableQuestion, at: number): AlmanacFact {
  return {
    id: q.id,
    category: q.category,
    q: q.q,
    answer: q.kind === 'number' ? null : q.options[q.answer],
    number:
      q.kind === 'number'
        ? { answer: q.number.answer, unit: q.number.unit, step: q.number.step, scale: q.number.scale }
        : null,
    fact: q.fact!,
    learnedAt: at,
  };
}

/**
 * A missed question (back to the first step, if it was coming back already) returns REVIEW.afterDays[0] days later.
 * In „Поправителен“ (`review`), one got right moves on to the next step, or is done after the last.
 */
function reschedule(userId: number, questionId: string, right: boolean, review: boolean, at: number) {
  if (!review) {
    if (right) return;
    run(
      `INSERT INTO review_queue (user_id, question_id, step, due_at) VALUES (?, ?, 0, ?)
       ON CONFLICT (user_id, question_id) DO UPDATE SET step = 0, due_at = excluded.due_at`,
      userId,
      questionId,
      at + REVIEW.afterDays[0] * DAY_MS,
    );
    return;
  }
  const entry = one<{ step: number }>(
    'SELECT step FROM review_queue WHERE user_id = ? AND question_id = ?',
    userId,
    questionId,
  );
  const step = right ? (entry?.step ?? 0) + 1 : 0;
  if (step >= REVIEW.afterDays.length) {
    run('DELETE FROM review_queue WHERE user_id = ? AND question_id = ?', userId, questionId);
    return;
  }
  run(
    `INSERT INTO review_queue (user_id, question_id, step, due_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, question_id) DO UPDATE SET step = excluded.step, due_at = excluded.due_at`,
    userId,
    questionId,
    step,
    at + REVIEW.afterDays[step] * DAY_MS,
  );
}

/**
 * After a match: what the player got right is theirs, what they missed comes back in „Поправителен“ (a review run
 * moves its questions along). Returns how many facts the match added. Call inside the match's transaction.
 */
export function noteMatch(userId: number, log: AnswerLogEntry[], review: boolean, at = Date.now()): number {
  for (const a of log) reschedule(userId, a.questionId, a.correct, review, at);
  return learn(
    userId,
    log.filter((a) => a.correct).map((a) => a.questionId),
    at,
  );
}

/** „Поправителен“ as it stands: due now, waiting, the next to come. */
export function reviewQueue(userId: number, now = Date.now()): ReviewQueue {
  const r = one<{ due: number; waiting: number; next: number | null }>(
    `SELECT SUM(due_at <= ?) AS due, SUM(due_at > ?) AS waiting, MIN(CASE WHEN due_at > ? THEN due_at END) AS next
     FROM review_queue WHERE user_id = ?`,
    now,
    now,
    now,
    userId,
  );
  const due = r?.due ?? 0;
  return { due, waiting: r?.waiting ?? 0, nextDueAt: r?.next ?? null, ready: due >= REVIEW.min };
}

/**
 * A „Поправителен“ run: the questions due longest, up to REVIEW.size (those with options first, a number last); null
 * when fewer than REVIEW.min are due. A question no longer played (hidden, or gone from the bank) leaves the queue.
 */
export function reviewQuestions(userId: number, now = Date.now()): PreparedQuestion[] | null {
  const due = all<{ question_id: string }>(
    'SELECT question_id FROM review_queue WHERE user_id = ? AND due_at <= ? ORDER BY due_at, question_id',
    userId,
    now,
  );
  const picked: PlayableQuestion[] = [];
  for (const { question_id } of due) {
    const q = inPlay(question_id);
    if (!q) run('DELETE FROM review_queue WHERE user_id = ? AND question_id = ?', userId, question_id);
    else if (picked.length < REVIEW.size) picked.push(q);
  }
  if (picked.length < REVIEW.min) return null;
  const ordered = [...picked.filter((q) => q.kind !== 'number'), ...picked.filter((q) => q.kind === 'number')];
  return reorderOptions(ordered, `review:${userId}:${now}`);
}

export function almanacOverview(userId: number, now = Date.now()): AlmanacOverview {
  const facts = learnedFacts(userId);
  const byCategory = factTotals();
  const tiers = new Map(earnedMastery(userId).map((m) => [m.category, m.tier]));
  return {
    facts: facts.length,
    total: factsInAll(),
    categories: CATEGORIES.map((c) => ({
      category: c.id,
      facts: facts.filter((f) => f.q.category === c.id).length,
      total: byCategory.get(c.id) ?? 0,
      tier: tiers.get(c.id) ?? null,
    })),
    review: reviewQueue(userId, now),
    recent: facts.slice(0, 5).map((f) => toFact(f.q, f.at)),
  };
}

export function almanacCategory(userId: number, category: CategoryId): AlmanacCategoryPage {
  return {
    category,
    facts: learnedFacts(userId)
      .filter((f) => f.q.category === category)
      .map((f) => toFact(f.q, f.at)),
    total: factTotals().get(category) ?? 0,
    tier: earnedMastery(userId).find((m) => m.category === category)?.tier ?? null,
  };
}
