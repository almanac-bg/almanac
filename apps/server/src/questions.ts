import fs from 'node:fs';
import path from 'node:path';
import { CATEGORY_IDS, type CategoryChoice, type CategoryId, type Difficulty, ROUNDS } from '@quiz/shared';
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
 * "Колко…?", "През коя година…?": a number typed in, scored by how close it is (NumberSpec). On a linear scale a guess
 * `tolerance` away scores nothing; on a log scale, one `tolerance` times too big or too small. A match's final.
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

/** Four options, one right. */
export type Question = z.infer<typeof QuestionSchema> & {
  /** Username of the player who submitted it (community questions only). */
  author?: string | null;
};

/** A question a match can play: four options, or a number. */
export type PlayableQuestion = Question | NumberQuestion;

/**
 * A question as one match plays it: one with options has them shuffled for the match (`answer` points into the
 * shuffled options); a number question is as the bank has it.
 */
export type PreparedQuestion = PlayableQuestion;

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

let everything: Map<string, PlayableQuestion> | null = null;
let bank: Question[] | null = null;
let numbers: NumberQuestion[] | null = null;

/** Every question by id, hidden ones included (for moderation and reports). */
export function questionById(id: string): PlayableQuestion | undefined {
  questionBank();
  return everything!.get(id);
}

/** An option as shown in a match, as the bank orders them (null if the question has changed since it was drawn). */
export function bankOption(q: Question, shown: number): number | null {
  const now = questionById(q.id);
  const index = now?.kind === 'number' ? -1 : (now?.options.indexOf(q.options[shown]) ?? -1);
  return index < 0 ? null : index;
}

/** Who wrote a question, as the bank has it now (community questions only): a rename or a deletion shows at once. */
export function questionAuthor(id: string): string | null {
  const q = questionById(id);
  return (q?.kind !== 'number' && q?.author) || null;
}

/**
 * A set kept for later (a day's, a link's) is kept without its authors' names: they come from the bank when the
 * questions are shown (questionAuthor), so a renamed or deleted author's old name isn't left behind in it.
 */
export const withoutAuthors = (questions: PreparedQuestion[]): PreparedQuestion[] =>
  questions.map((q) => {
    if (q.kind === 'number') return q;
    const { author: _author, ...rest } = q;
    return rest;
  });

/**
 * Questions with options matches draw from: built-in ones from the JSON file plus approved community questions, minus
 * hidden ones.
 */
export function questionBank(): Question[] {
  if (!bank) ({ everything, bank, numbers } = loadBank());
  return bank;
}

/** Number questions finals draw from, minus hidden ones. */
export function numberBank(): NumberQuestion[] {
  questionBank();
  return numbers!;
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
    ({ everything, bank, numbers } = loadBank());
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
let waiting = { order: 0, image: 0 };
export const waitingFormats = () => waiting;

function loadBank(): { everything: Map<string, PlayableQuestion>; bank: Question[]; numbers: NumberQuestion[] } {
  const file = readBankFile();
  waiting = { order: file.order.length, image: file.choice.filter((q) => q.image).length };
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
  const everything = new Map<string, PlayableQuestion>(
    [...builtIn, ...community, ...file.number].map((q) => [q.id, q]),
  );
  // Until the game shows pictures, a question with one is held back (it may need the picture to be answered).
  const bank = [...builtIn, ...community].filter((q) => !hidden.has(q.id) && !q.image);
  const numbers = file.number.filter((q) => !hidden.has(q.id));
  console.log(
    `📚 ${builtIn.length} built-in + ${community.length} community questions, ${file.number.length} number questions${
      hidden.size ? `, ${hidden.size} hidden` : ''
    }${
      waiting.order + waiting.image
        ? ` (waiting for the game to play them: ${waiting.order} order, ${waiting.image} with an image)`
        : ''
    }`,
  );
  if (QUESTIONS_PATH === SAMPLE_BANK) {
    (config.production ? console.warn : console.log)(
      '📚 Playing the public sample bank: put the real one in private/questions.json (or set QUESTIONS_PATH).',
    );
  }
  return { everything, bank, numbers };
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

/** A question with its options in an order of their own (`answer` follows the right one). */
function shuffled(q: Question, rng: Rng): Question {
  const order = shuffle([0, 1, 2, 3], rng);
  return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
}

/** Unseen first (in random order), then the ones seen longest ago (or lowest in `seen`, whatever it ranks by). */
const leastSeenFirst = <T extends { id: string }>(pool: T[], seen: ReadonlyMap<string, number>, rng: Rng) =>
  shuffle(pool, rng).sort((a, b) => (seen.get(a.id) ?? 0) - (seen.get(b.id) ?? 0));

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
): Question[] {
  const pool = questionBank().filter((q) => category === 'mixed' || q.category === category);
  // Shuffled first, so unseen questions (and ones seen in the same match) come in random order; the sort is stable.
  const ordered = leastSeenFirst(pool, seen, rng);

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
    .map(({ q }) => shuffled(q, rng));
}

/**
 * A number question nobody in the match has seen for this long can be a final again in a match of one category: a
 * category has only a few, and the same one every few runs is no final.
 */
const FINAL_REPEAT_MS = 30 * 24 * 60 * 60_000;

/**
 * A match's final: a number question, unseen first, then the one seen longest ago. In a match of one category only one
 * not seen for FINAL_REPEAT_MS; null when there's none (the match then ends on a question with options). `not`:
 * categories the match plays otherwise.
 */
export function pickFinal(
  category: CategoryChoice,
  seen: ReadonlyMap<string, number>,
  rng: Rng = Math.random,
  opts: { not?: readonly CategoryId[]; now?: number } = {},
): NumberQuestion | null {
  const pool = numberBank().filter(
    (q) => (category === 'mixed' || q.category === category) && !opts.not?.includes(q.category),
  );
  const [first] = leastSeenFirst(pool, seen, rng);
  if (!first) return null;
  if (category !== 'mixed' && (seen.get(first.id) ?? 0) > (opts.now ?? Date.now()) - FINAL_REPEAT_MS) return null;
  return first;
}

/** A match's `count` questions, as pickQuestions picks them, the last one its final when it has one (pickFinal). */
export function pickMatch(
  count: number,
  category: CategoryChoice,
  seen: ReadonlyMap<string, number>,
  opts: { final: boolean; rng?: Rng },
): PreparedQuestion[] {
  const rng = opts.rng ?? Math.random;
  const final = opts.final ? pickFinal(category, seen, rng) : null;
  return final ? [...pickQuestions(count - 1, category, seen, rng), final] : pickQuestions(count, category, seen, rng);
}

/** One round of a match in ROUNDS: drawn (`category`), or picked from `offers` when it comes. */
export interface RoundPlan {
  from: number;
  size: number;
  category: CategoryId | null;
  /** The categories on offer and the questions each would bring (drawn up front: the match never waits on the bank). */
  offers: { category: CategoryId; questions: Question[] }[];
}

/** `difficulties.length` questions of one category, unseen first, none of `used` (which they join). */
function drawFrom(
  category: CategoryId,
  difficulties: readonly Difficulty[],
  seen: ReadonlyMap<string, number>,
  used: Set<string>,
  rng: Rng,
): Question[] | null {
  const pool = leastSeenFirst(
    questionBank().filter((q) => q.category === category && !used.has(q.id)),
    seen,
    rng,
  );
  const picked: Question[] = [];
  for (const d of difficulties) {
    const q = pool.find((x) => x.difficulty === d && !picked.includes(x)) ?? pool.find((x) => !picked.includes(x));
    if (!q) return null;
    picked.push(q);
  }
  for (const q of picked) used.add(q.id);
  return picked.map((q) => shuffled(q, rng));
}

/**
 * A match in ROUNDS (Дуел): the first round drawn, the questions of every category on offer for the later ones, and
 * a final from a category none of them plays. Until a round is picked, `questions` holds its first offer. Null when
 * the bank is too thin for it.
 */
export function pickRounds(
  seen: ReadonlyMap<string, number>,
  rng: Rng = Math.random,
): { questions: PreparedQuestion[]; rounds: RoundPlan[] } | null {
  const used = new Set<string>();
  const final = pickFinal('mixed', seen, rng);
  const categories = shuffle(
    CATEGORY_IDS.filter((c) => c !== final?.category),
    rng,
  );
  let next = 0;
  const offersFor = (round: number, wanted: number) => {
    const offers: RoundPlan['offers'] = [];
    while (offers.length < wanted && next < categories.length) {
      const category = categories[next++];
      const questions = drawFrom(category, ROUNDS.difficulty[round], seen, used, rng);
      if (questions) offers.push({ category, questions });
    }
    return offers;
  };

  const [first] = offersFor(0, 1);
  if (!first) return null;
  const rounds: RoundPlan[] = [{ from: 0, size: ROUNDS.size, category: first.category, offers: [] }];
  const questions: PreparedQuestion[] = [...first.questions];
  for (let r = 1; r < ROUNDS.count; r++) {
    const offers = offersFor(r, ROUNDS.offer);
    // A pick between fewer than two is no pick.
    if (offers.length < 2) return null;
    rounds.push({ from: r * ROUNDS.size, size: ROUNDS.size, category: null, offers });
    questions.push(...offers[0].questions);
  }
  // No number question in the bank: a hard one from a category of its own closes the match instead.
  let closing: PreparedQuestion | null = final;
  while (!closing && next < categories.length)
    closing = drawFrom(categories[next++], ['hard'], seen, used, rng)?.[0] ?? null;
  return closing ? { questions: [...questions, closing], rounds } : null;
}

/**
 * The same questions with the options in an order of their own for this seed (e.g. a day and a player): a set everyone
 * plays stays the same, but "the answers were Б, А, Г…" gives nothing away. The seed is mixed with this server's own
 * secret: the code is public, and without it one player's order would convert into anyone else's.
 */
export function reorderOptions(questions: PreparedQuestion[], seed: string): PreparedQuestion[] {
  const secret = installationSecret('option-order');
  return questions.map((q) => (q.kind === 'number' ? q : shuffled(q, seededRng(`${secret}:${seed}:${q.id}`))));
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
