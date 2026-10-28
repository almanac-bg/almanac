import fs from 'node:fs';
import path from 'node:path';
import { CATEGORY_IDS, type CategoryChoice, type CategoryId, type Difficulty } from '@quiz/shared';
import { z } from 'zod';
import { config } from './config';
import { all, run, tx } from './db';
import { reportError } from './monitoring';
import { installationSecret } from './settings';

/** The longest "Знаеше ли?" fact: one or two sentences, readable at a glance. */
export const FACT_MAX = 200;

/** What every format has: where it belongs, how hard it's meant to be, the question, and what's behind it. */
const common = {
  id: z.string().min(1),
  category: z.enum(CATEGORY_IDS as [CategoryId, ...CategoryId[]]),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  q: z.string().min(1),
  /** "Знаеше ли?": something worth knowing behind the answer, shown once it's revealed. */
  fact: z.string().min(1).max(FACT_MAX).optional(),
  /** Where the fact can be checked (for whoever reviews the bank; players never see it). */
  factSource: z.url({ protocol: /^https$/ }).optional(),
  /** Where the answer can be checked (for whoever reviews the bank). */
  answerSource: z.url({ protocol: /^https$/ }).optional(),
  /** Topics across categories ("bg" for Bulgaria, "football"…): themed sets and links draw on them. */
  tags: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).optional(),
  /** When it joined the bank (YYYY-MM-DD). */
  added: z.iso.date().optional(),
  /** When its answer may no longer hold (a record, an office, a count): checked again by then. */
  reviewBy: z.iso.date().optional(),
};

/** A picture over the question (a flag, a landmark, a painting), with its licence: free licences only. */
const ImageSchema = z.object({
  /** The file under the site's image store; its name says nothing about the answer. */
  file: z.string().regex(/^[\w-]+\.(webp|jpg|png)$/),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  /** What's in it, for screen readers (without giving the answer away). */
  alt: z.string().min(3),
  credit: z.string().min(1),
  license: z.enum(['PD', 'CC0', 'CC BY', 'CC BY-SA']),
  sourceUrl: z.url({ protocol: /^https$/ }),
});

const needsFactSource = (q: { fact?: string; factSource?: string }) => !q.fact || !!q.factSource;
const factSourceIssue = { message: 'a fact needs its source (factSource)', path: ['factSource'] };

/** Four options, one right: what every match plays today. With an image, it waits until the game shows images. */
const QuestionSchema = z
  .object({
    ...common,
    kind: z.literal('choice').optional(),
    options: z.array(z.string().min(1)).length(4),
    answer: z.number().int().min(0).max(3),
    image: ImageSchema.optional(),
  })
  .refine(needsFactSource, factSourceIssue);

/**
 * "Колко…?", "През коя година…?": a number typed in, scored by how close it is. On a linear scale a guess `tolerance`
 * away scores nothing; on a log scale, one `tolerance` times too big or too small. Not played yet (the format comes
 * with the game's next version); the bank can hold them.
 */
const NumberQuestionSchema = z
  .object({
    ...common,
    kind: z.literal('number'),
    number: z
      .object({
        answer: z.number(),
        /** What the number counts ("г.", "км", "души"); empty for a year. */
        unit: z.string(),
        /** The range the keypad or slider allows. */
        min: z.number(),
        max: z.number(),
        step: z.number().positive(),
        scale: z.enum(['linear', 'log']),
        tolerance: z.number().positive(),
      })
      .refine((n) => n.min <= n.answer && n.answer <= n.max, { message: 'the answer is outside min–max' })
      .refine((n) => n.scale === 'linear' || (n.min > 0 && n.tolerance > 1), {
        message: 'a log scale needs min above 0 and a tolerance above 1 (a factor)',
      }),
  })
  .refine(needsFactSource, factSourceIssue);

/** "Подреди": four things put in order by a number each has (a year, a height…). Not played yet either. */
const OrderQuestionSchema = z
  .object({
    ...common,
    kind: z.literal('order'),
    items: z
      .array(z.object({ text: z.string().min(1).max(45), value: z.number() }))
      .length(4)
      .refine((items) => new Set(items.map((i) => i.value)).size === 4, { message: 'two items share a value' }),
    direction: z.enum(['asc', 'desc']),
  })
  .refine(needsFactSource, factSourceIssue);

export type NumberQuestion = z.infer<typeof NumberQuestionSchema>;
export type OrderQuestion = z.infer<typeof OrderQuestionSchema>;

export type Question = z.infer<typeof QuestionSchema> & {
  /** Username of the player who submitted it (community questions only). */
  author?: string | null;
};

/** A question with its options shuffled for one match; `answer` points into the shuffled options. */
export type PreparedQuestion = Question;

/**
 * The real question bank is private (`private/questions.json` at the repository root; it isn't part of the public
 * code), so players can't look answers up and the content can't simply be copied. Builds made with it carry it next
 * to the bundle. Without it, the server plays the small public sample — enough to develop and run the tests.
 */
const PRIVATE_BANK = [
  path.join(import.meta.dirname, 'data', 'questions.json'),
  path.resolve(import.meta.dirname, '../../../private/questions.json'),
];
const SAMPLE_BANK = path.join(import.meta.dirname, 'data', 'questions.sample.json');
const QUESTIONS_PATH = process.env.QUESTIONS_PATH ?? PRIVATE_BANK.find((file) => fs.existsSync(file)) ?? SAMPLE_BANK;

let everything: Map<string, Question> | null = null;
let bank: Question[] | null = null;

/** Every question by id, hidden ones included (for moderation and reports). */
export function questionById(id: string): Question | undefined {
  questionBank();
  return everything!.get(id);
}

/** An option as shown in a match, as the bank orders them (null if the question has changed since it was drawn). */
export function bankOption(q: PreparedQuestion, shown: number): number | null {
  const index = questionById(q.id)?.options.indexOf(q.options[shown]) ?? -1;
  return index < 0 ? null : index;
}

/** Who wrote a question, as the bank has it now (community questions only): a rename or a deletion shows at once. */
export const questionAuthor = (id: string) => questionById(id)?.author ?? null;

/**
 * A set kept for later (a day's, a link's) is kept without its authors' names: they come from the bank when the
 * questions are shown (questionAuthor), so a renamed or deleted author's old name isn't left behind in it.
 */
export const withoutAuthors = (questions: PreparedQuestion[]) => questions.map(({ author: _author, ...q }) => q);

/** Questions matches draw from: built-in ones from the JSON file plus approved community questions, minus hidden ones. */
export function questionBank(): Question[] {
  if (!bank) ({ everything, bank } = loadBank());
  return bank;
}

/** The last reload's error, while the bank on disk can't be read (the one loaded before keeps the game going). */
let reloadFailure: string | null = null;
export const bankProblem = () => reloadFailure;

/**
 * Call after approving or hiding a question so new matches see the change. The new bank replaces the old one only
 * once it has loaded: a broken file (a bad pull of the private bank) leaves the game on the bank it has, says so in
 * /api/health, and is reported, rather than stopping every match from starting.
 */
export function reloadQuestionBank() {
  try {
    ({ everything, bank } = loadBank());
    reloadFailure = null;
  } catch (err) {
    reloadFailure = err instanceof Error ? err.message : String(err);
    void reportError(err, 'reload the question bank');
  }
}

/** The bank file's questions by format, each checked against its own schema (the first problems, with their ids). */
function readBankFile(): { choice: Question[]; number: NumberQuestion[]; order: OrderQuestion[] } {
  const items = z.array(z.record(z.string(), z.unknown())).parse(JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8')));
  const read = { choice: [] as Question[], number: [] as NumberQuestion[], order: [] as OrderQuestion[] };
  const problems: string[] = [];
  for (const item of items) {
    const kind = item.kind ?? 'choice';
    const schema =
      kind === 'choice'
        ? QuestionSchema
        : kind === 'number'
          ? NumberQuestionSchema
          : kind === 'order'
            ? OrderQuestionSchema
            : null;
    if (!schema) {
      problems.push(`${String(item.id)}: unknown kind ${String(kind)}`);
      continue;
    }
    const parsed = schema.safeParse(item);
    if (!parsed.success) {
      problems.push(
        `${String(item.id)}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      );
      continue;
    }
    (read[kind as keyof typeof read] as unknown[]).push(parsed.data);
  }
  if (problems.length) throw new Error(`The question bank has problems: ${problems.slice(0, 5).join(' | ')}`);
  return read;
}

/** Questions in the formats the game doesn't play yet, by format (kept for the next version). */
let waiting = { number: 0, order: 0, image: 0 };
export const waitingFormats = () => waiting;

function loadBank(): { everything: Map<string, Question>; bank: Question[] } {
  const file = readBankFile();
  waiting = { number: file.number.length, order: file.order.length, image: file.choice.filter((q) => q.image).length };
  const builtIn = file.choice;
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
  ).map((r): Question => ({ ...r, options: JSON.parse(r.options) as string[] }));
  const hidden = new Set(
    all<{ question_id: string }>('SELECT question_id FROM hidden_questions').map((r) => r.question_id),
  );
  const everything = new Map([...builtIn, ...community].map((q) => [q.id, q]));
  // Until the game shows pictures, a question with one is held back (it may need the picture to be answered).
  const bank = [...everything.values()].filter((q) => !hidden.has(q.id) && !q.image);
  console.log(
    `📚 ${builtIn.length} built-in + ${community.length} community questions${hidden.size ? `, ${hidden.size} hidden` : ''}${
      waiting.number + waiting.order + waiting.image
        ? ` (waiting for the game to play them: ${waiting.number} number, ${waiting.order} order, ${waiting.image} with an image)`
        : ''
    }`,
  );
  if (QUESTIONS_PATH === SAMPLE_BANK) {
    (config.production ? console.warn : console.log)(
      '📚 Playing the public sample bank: put the real one in private/questions.json (or set QUESTIONS_PATH).',
    );
  }
  return { everything, bank };
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
 * How far a question may wander from its difficulty's place in the match: neighbours trade places at the seams (an
 * easy one after a medium, a medium after a hard), while easy and hard never swap. In lockstep, the first medium was
 * always question 5 (where "Двойно или нищо" always went) and Royale's first knockout was always decided on easy ones.
 */
const RAMP_BLUR = 1.25;

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
    .map((q) => ({ q, place: DIFFICULTY_ORDER[q.difficulty] + rng() * RAMP_BLUR }))
    .sort((a, b) => a.place - b.place)
    .map(({ q }) => {
      const order = shuffle([0, 1, 2, 3], rng);
      return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
    });
}

/**
 * The same questions with the options in an order of their own for this seed (e.g. a day and a player): a set everyone
 * plays stays the same, but "the answers were Б, А, Г…" gives nothing away. The seed is mixed with this server's own
 * secret: the code is public, and without it one player's order would convert into anyone else's.
 */
export function reorderOptions(questions: PreparedQuestion[], seed: string): PreparedQuestion[] {
  const secret = installationSecret('option-order');
  return questions.map((q) => {
    const order = shuffle([0, 1, 2, 3], seededRng(`${secret}:${seed}:${q.id}`));
    return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
  });
}

/**
 * How many of a player's most recent questions are remembered: more than the whole bank (heading for 5000), so a player
 * who has seen everything gets the ones seen longest ago first. A forgotten question would count as new again and jump
 * the queue. Only the heaviest players ever get near it.
 */
export const RECENT_LIMIT = 6000;

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
