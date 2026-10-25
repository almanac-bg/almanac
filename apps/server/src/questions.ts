import fs from 'node:fs';
import path from 'node:path';
import { CATEGORY_IDS, type CategoryChoice, type CategoryId, type Difficulty } from '@quiz/shared';
import { z } from 'zod';
import { all, run, tx } from './db';

const QuestionSchema = z.object({
  id: z.string().min(1),
  category: z.enum(CATEGORY_IDS as [CategoryId, ...CategoryId[]]),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  q: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),
  answer: z.number().int().min(0).max(3),
});

export type Question = z.infer<typeof QuestionSchema> & {
  /** Username of the player who submitted it (community questions only). */
  author?: string | null;
};

/** A question with its options shuffled for one match; `answer` points into the shuffled options. */
export type PreparedQuestion = Question;

const QUESTIONS_PATH = process.env.QUESTIONS_PATH ?? path.join(import.meta.dirname, 'data', 'questions.json');

let everything: Map<string, Question> | null = null;
let bank: Question[] | null = null;

/** Every question by id, hidden ones included (for moderation and reports). */
export function questionById(id: string): Question | undefined {
  questionBank();
  return everything!.get(id);
}

/** Questions matches draw from: built-in ones from the JSON file plus approved community questions, minus hidden ones. */
export function questionBank(): Question[] {
  if (!bank) {
    const builtIn = z.array(QuestionSchema).parse(JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8')));
    const community = all<{
      id: string;
      category: CategoryId;
      difficulty: Difficulty;
      q: string;
      options: string;
      answer: number;
      author: string | null;
    }>(
      `SELECT q.id, q.category, q.difficulty, q.q, q.options, q.answer, u.username AS author
       FROM questions q LEFT JOIN users u ON u.id = q.author_id`,
    ).map((r) => ({ ...r, options: JSON.parse(r.options) as string[] }));
    const hidden = new Set(all<{ question_id: string }>('SELECT question_id FROM hidden_questions').map((r) => r.question_id));
    everything = new Map([...builtIn, ...community].map((q) => [q.id, q]));
    bank = [...everything.values()].filter((q) => !hidden.has(q.id));
    console.log(`📚 ${builtIn.length} built-in + ${community.length} community questions${hidden.size ? `, ${hidden.size} hidden` : ''}`);
  }
  return bank;
}

/** Call after approving or hiding a question so new matches see the change. */
export function reloadQuestionBank() {
  bank = null;
  questionBank();
}

export type Rng = () => number;

export function shuffle<T>(items: T[], rng: Rng = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Deterministic PRNG (mulberry32) seeded from a string — same seed, same sequence. */
export function seededRng(seed: string): Rng {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIFFICULTY_ORDER: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };

/**
 * Picks `count` questions: ones none of the players has seen first, then the ones seen longest ago, with a 40/40/20
 * easy/medium/hard mix ordered so the match ramps up. `seen` maps question ids to when any of the players last saw them.
 */
export function pickQuestions(
  count: number,
  category: CategoryChoice,
  seen: ReadonlyMap<string, number>,
  rng: Rng = Math.random,
): PreparedQuestion[] {
  const pool = questionBank().filter((q) => category === 'mixed' || q.category === category);
  // Shuffled first, so unseen questions (and ones seen in the same match) come in random order; the sort is stable.
  const ordered = shuffle(pool, rng).sort((a, b) => (seen.get(a.id) ?? 0) - (seen.get(b.id) ?? 0));

  const hard = Math.round(count * 0.2);
  const easy = Math.round(count * 0.4);
  const quota: Record<Difficulty, number> = { easy, medium: count - easy - hard, hard };
  const perCategoryCap = category === 'mixed' ? Math.ceil(count / 4) : Infinity;
  const perCategory = new Map<CategoryId, number>();
  const picked: Question[] = [];

  const take = (respectQuota: boolean, respectCap: boolean) => {
    for (const q of ordered) {
      if (picked.length >= count) return;
      if (picked.includes(q)) continue;
      if (respectQuota && quota[q.difficulty] <= 0) continue;
      if (respectCap && (perCategory.get(q.category) ?? 0) >= perCategoryCap) continue;
      picked.push(q);
      quota[q.difficulty]--;
      perCategory.set(q.category, (perCategory.get(q.category) ?? 0) + 1);
    }
  };
  take(true, true);
  take(false, true);
  take(false, false);

  return picked
    .sort((a, b) => DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty])
    .map((q) => {
      const order = shuffle([0, 1, 2, 3], rng);
      return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
    });
}

/** How many of a player's most recent questions are remembered (most of the bank); older ones count as new again. */
export const RECENT_LIMIT = 1500;

/** Remembers a match's questions for each player, keeping only the newest RECENT_LIMIT. */
export function markSeen(userId: number, questionIds: string[]) {
  const now = Date.now();
  tx(() => {
    for (const id of questionIds) {
      run(
        `INSERT INTO seen_questions (user_id, question_id, seen_at) VALUES (?, ?, ?)
         ON CONFLICT (user_id, question_id) DO UPDATE SET seen_at = excluded.seen_at`,
        userId,
        id,
        now,
      );
    }
    run(
      `DELETE FROM seen_questions WHERE user_id = ? AND seen_at < (
         SELECT seen_at FROM seen_questions WHERE user_id = ? ORDER BY seen_at DESC LIMIT 1 OFFSET ?)`,
      userId,
      userId,
      RECENT_LIMIT - 1,
    );
  });
}

/** When any of these players last saw each question they saw recently. */
export function recentFor(userIds: number[]): Map<string, number> {
  if (!userIds.length) return new Map();
  return new Map(
    all<{ question_id: string; seen_at: number }>(
      `SELECT question_id, MAX(seen_at) AS seen_at FROM seen_questions
       WHERE user_id IN (${userIds.map(() => '?').join(',')}) GROUP BY question_id`,
      ...userIds,
    ).map((r) => [r.question_id, r.seen_at]),
  );
}
