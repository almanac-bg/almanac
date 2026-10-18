import fs from 'node:fs';
import path from 'node:path';
import { CATEGORY_IDS, type CategoryChoice, type CategoryId, type Difficulty } from '@quiz/shared';
import { z } from 'zod';
import { all } from './db';

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

let bank: Question[] | null = null;

/** Built-in questions from the JSON file plus approved community questions from the database. */
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
    bank = [...builtIn, ...community];
    console.log(`📚 ${builtIn.length} built-in + ${community.length} community questions`);
  }
  return bank;
}

/** Call after approving a question so new matches can draw it. */
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
 * Picks `count` questions, preferring ones none of the players saw recently,
 * with a 40/40/20 easy/medium/hard mix ordered so the match ramps up.
 */
export function pickQuestions(
  count: number,
  category: CategoryChoice,
  avoid: ReadonlySet<string>,
  rng: Rng = Math.random,
): PreparedQuestion[] {
  const pool = questionBank().filter((q) => category === 'mixed' || q.category === category);
  const ordered = [
    ...shuffle(
      pool.filter((q) => !avoid.has(q.id)),
      rng,
    ),
    ...shuffle(
      pool.filter((q) => avoid.has(q.id)),
      rng,
    ),
  ];

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

const RECENT_LIMIT = 150;
const recentlySeen = new Map<number, string[]>();

export function markSeen(userId: number, questionIds: string[]) {
  const list = [...(recentlySeen.get(userId) ?? []), ...questionIds];
  recentlySeen.set(userId, list.slice(-RECENT_LIMIT));
}

export function recentFor(userIds: number[]): Set<string> {
  return new Set(userIds.flatMap((id) => recentlySeen.get(id) ?? []));
}
