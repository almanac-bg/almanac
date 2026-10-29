import fs from 'node:fs';
import path from 'node:path';
import {
  CATEGORY_IDS,
  type CategoryChoice,
  type CategoryId,
  type Difficulty,
  type Formats,
  IMAGE,
  type ImageCredit,
  type QuestionImage,
  type RightOrder,
  ROUNDS,
  rightOrder,
  TEXT_ONLY,
} from '@quiz/shared';
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

/**
 * A picture over the question (a flag, a landmark, a painting), with its licence: free licences only. The file is in
 * `images/` next to the bank, its longer side IMAGE.side, with one half the size beside it (`<name>-600.webp`); its name
 * is a hash of its content, so it says nothing about the answer.
 */
const ImageSchema = z.object({
  file: z.string().regex(/^[0-9a-f]{16}\.webp$/),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  /** What's in it, for screen readers (without giving the answer away). */
  alt: z.string().min(3).max(150),
  /** Whose it is (an author's name, or „неизвестен автор“). */
  credit: z.string().min(1).max(120),
  /**
   * Public domain or a free licence, and its version (`licenseVersion`: CC BY-SA 3.0). Apart: the release before
   * pictures played reads this file too (a rollback), and knows only the four.
   */
  license: z.enum(['PD', 'CC0', 'CC BY', 'CC BY-SA']),
  licenseVersion: z
    .string()
    .regex(/^[1-4]\.[05]$/)
    .optional(),
  sourceUrl: z.url({ protocol: /^https$/ }),
});

const needsFactSource = (q: { fact?: string; factSource?: string }) => !q.fact || !!q.factSource;
const factSourceIssue = { message: 'a fact needs its source (factSource)', path: ['factSource'] };

/** Four options, one right; with a picture, the question is about it (a match places those itself: pickMatch). */
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

/** „Подреди“: four things put in order by a number each has (a year, a height…), shown with the answer. */
const OrderQuestionSchema = z
  .object({
    ...common,
    kind: z.literal('order'),
    items: z
      .array(z.object({ text: z.string().min(1).max(45), value: z.number() }))
      .length(4)
      .refine((items) => new Set(items.map((i) => i.value)).size === 4, { message: 'two items share a value' }),
    direction: z.enum(['asc', 'desc']),
    /** What the values count („м“, „км²“); none for years. */
    unit: z.string().max(12).optional(),
  })
  .refine(needsFactSource, factSourceIssue);

export type NumberQuestion = z.infer<typeof NumberQuestionSchema>;
/** `hideValues`: a host's own order question without numbers to show with the answer (its values are just places). */
export type OrderQuestion = z.infer<typeof OrderQuestionSchema> & { hideValues?: boolean };

type BankImage = z.infer<typeof ImageSchema>;

/** A host's own picture in a question of their set (sets.ts): one size, served by the API, nobody's credit to show. */
export interface HostImage {
  url: string;
  w: number;
  h: number;
  alt: string;
}

/** Four options, one right. */
export type Question = Omit<z.infer<typeof QuestionSchema>, 'image'> & {
  image?: BankImage | HostImage;
  /** Username of the player who submitted it (community questions only). */
  author?: string | null;
};

/** A question a match can play: four options (perhaps with a picture), a number, or four things to order. */
export type PlayableQuestion = Question | NumberQuestion | OrderQuestion;

/**
 * A question as one match plays it: one with options has them shuffled for the match (`answer` points into the
 * shuffled options), an order question its items; a number question is as the bank has it.
 */
export type PreparedQuestion = PlayableQuestion;

/** An order question's right order: its items' indices (as this match shows them), first to last. */
export const orderOf = (q: OrderQuestion) =>
  rightOrder(
    q.items.map((i) => i.value),
    q.direction,
  );

/** An order question's answer as reviews and the almanac show it: the items in their right order, with their numbers. */
export const rightOrderOf = (q: OrderQuestion): RightOrder => ({
  items: orderOf(q).map((i) => q.items[i]),
  unit: q.unit ?? '',
});

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
let images: Question[] | null = null;
let numbers: NumberQuestion[] | null = null;
let orders: OrderQuestion[] | null = null;
let playable: Map<string, PlayableQuestion> | null = null;

/** Every question by id, hidden ones included (for moderation and reports). */
export function questionById(id: string): PlayableQuestion | undefined {
  questionBank();
  return everything!.get(id);
}

/** A question new matches may play (not hidden, not waiting for a format the game can't play yet). */
export function inPlay(id: string): PlayableQuestion | undefined {
  questionBank();
  return playable!.get(id);
}

/** An option as shown in a match, as the bank orders them (null if the question has changed since it was drawn). */
export function bankOption(q: Question, shown: number): number | null {
  const now = questionById(q.id);
  if (!now || now.kind === 'number' || now.kind === 'order') return null;
  const index = now.options.indexOf(q.options[shown]);
  return index < 0 ? null : index;
}

/**
 * An order as given in a match (the shown items' indices), as the bank orders the items: what a run keeps, so a
 * replay with the items shuffled anew means the same. Null if the question has changed since.
 */
export function bankOrder(q: OrderQuestion, given: readonly number[]): number[] | null {
  const now = questionById(q.id);
  if (now?.kind !== 'order') return null;
  const order = given.map((shown) => now.items.findIndex((i) => i.text === q.items[shown]?.text));
  return order.some((i) => i < 0) ? null : order;
}

/** Who wrote a question, as the bank has it now (community questions only): a rename or a deletion shows at once. */
export function questionAuthor(id: string): string | null {
  const q = questionById(id);
  return (q && isChoice(q) && q.author) || null;
}

/** A question with options to pick from. */
export const isChoice = (q: PlayableQuestion): q is Question => q.kind !== 'number' && q.kind !== 'order';

/** Where the banks' pictures are: `images/` next to the bank file. */
export const imageDir = () => path.join(path.dirname(QUESTIONS_PATH), 'images');

/** The URL path pictures are served under (index.ts), cached for good: a file's name changes with its content. */
export const IMAGE_PATH = '/qimg';

/** A picture's small version, beside it. */
export const smallImage = (file: string) => file.replace(/\.webp$/, '-600.webp');

/** A question's picture as a player gets it (none if it has none). */
export function questionImage(q: PreparedQuestion): QuestionImage | null {
  const image = 'image' in q ? q.image : undefined;
  if (!image) return null;
  if ('url' in image)
    return { src: image.url, srcSet: `${image.url} ${image.w}w`, w: image.w, h: image.h, alt: image.alt };
  // The small one is half the size (bank.mjs image).
  const src = `${IMAGE_PATH}/${smallImage(image.file)}`;
  return {
    src,
    srcSet: `${src} ${Math.round(image.w / 2)}w, ${IMAGE_PATH}/${image.file} ${image.w}w`,
    w: image.w,
    h: image.h,
    alt: image.alt,
  };
}

/** Whose a question's picture is, for the reveal (a host's own: nobody's to show). */
export function imageCredit(q: PreparedQuestion): ImageCredit | null {
  const image = 'image' in q ? q.image : undefined;
  if (!image || !('file' in image)) return null;
  const license = image.licenseVersion ? `${image.license} ${image.licenseVersion}` : image.license;
  return { credit: image.credit, license, sourceUrl: image.sourceUrl };
}

/**
 * A set kept for later (a day's, a link's) is kept without its authors' names: they come from the bank when the
 * questions are shown (questionAuthor), so a renamed or deleted author's old name isn't left behind in it.
 */
export const withoutAuthors = (questions: PreparedQuestion[]): PreparedQuestion[] =>
  questions.map((q) => {
    if (!isChoice(q)) return q;
    const { author: _author, ...rest } = q;
    return rest;
  });

/**
 * Questions with options matches draw from: built-in ones from the JSON file plus approved community questions, minus
 * hidden ones and those with a picture (imageBank: a match places those itself).
 */
export function questionBank(): Question[] {
  if (!bank) ({ everything, bank, images, numbers, orders, playable } = loadBank());
  return bank;
}

/** Questions about a picture, minus hidden ones and any whose picture is missing. */
export function imageBank(): Question[] {
  questionBank();
  return images!;
}

/** Number questions finals draw from, minus hidden ones. */
export function numberBank(): NumberQuestion[] {
  questionBank();
  return numbers!;
}

/** Order questions („Подреди“), minus hidden ones. */
export function orderBank(): OrderQuestion[] {
  questionBank();
  return orders!;
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
    ({ everything, bank, images, numbers, orders, playable } = loadBank());
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

/** Questions held back: those whose picture isn't there (a bad pull of the private bank). */
let missingImages: string[] = [];
export const questionsWithoutImages = () => missingImages;

function loadBank(): {
  everything: Map<string, PlayableQuestion>;
  bank: Question[];
  images: Question[];
  numbers: NumberQuestion[];
  orders: OrderQuestion[];
  playable: Map<string, PlayableQuestion>;
} {
  const file = readBankFile();
  const dir = imageDir();
  const present = (q: Question) =>
    !!q.image &&
    'file' in q.image &&
    fs.existsSync(path.join(dir, q.image.file)) &&
    fs.existsSync(path.join(dir, smallImage(q.image.file)));
  missingImages = file.choice.filter((q) => q.image && !present(q)).map((q) => q.id);
  const builtIn = file.choice;
  const community = all<{
    id: string;
    category: CategoryId;
    difficulty: Difficulty;
    q: string;
    options: string;
    answer: number;
    author: string | null;
    fact: string | null;
    fact_source: string | null;
    answer_source: string | null;
  }>(
    `SELECT q.id, q.category, q.difficulty, q.q, q.options, q.answer, q.fact, q.fact_source, q.answer_source,
       u.username AS author
     FROM questions q LEFT JOIN users u ON u.id = q.author_id`,
  ).map(
    ({ fact, fact_source, answer_source, ...r }): Question => ({
      ...r,
      options: JSON.parse(r.options) as string[],
      ...(fact && { fact, factSource: fact_source ?? undefined }),
      ...(answer_source && { answerSource: answer_source }),
    }),
  );
  const hidden = new Set(
    all<{ question_id: string }>('SELECT question_id FROM hidden_questions').map((r) => r.question_id),
  );
  const everything = new Map<string, PlayableQuestion>(
    [...builtIn, ...community, ...file.number, ...file.order].map((q) => [q.id, q]),
  );
  const bank = [...builtIn, ...community].filter((q) => !hidden.has(q.id) && !q.image);
  const images = builtIn.filter((q) => q.image && !hidden.has(q.id) && present(q));
  const numbers = file.number.filter((q) => !hidden.has(q.id));
  const orders = file.order.filter((q) => !hidden.has(q.id));
  console.log(
    `📚 ${builtIn.length - images.length} built-in + ${community.length} community questions, ${images.length} with a picture, ${
      file.number.length
    } number, ${file.order.length} order${hidden.size ? `, ${hidden.size} hidden` : ''}`,
  );
  if (missingImages.length) {
    const message = `Held back, their picture isn't in ${dir}: ${missingImages.slice(0, 10).join(', ')}`;
    console.warn(`📚 ${message}`);
    void reportError(new Error(message), 'question pictures');
  }
  if (QUESTIONS_PATH === SAMPLE_BANK) {
    (config.production ? console.warn : console.log)(
      '📚 Playing the public sample bank: put the real one in private/questions.json (or set QUESTIONS_PATH).',
    );
  }
  return {
    everything,
    bank,
    images,
    numbers,
    orders,
    playable: new Map<string, PlayableQuestion>([...bank, ...images, ...numbers, ...orders].map((q) => [q.id, q])),
  };
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

/** A question with its options in an order of their own (`answer` follows the right one); an order question's items. */
function shuffled<Q extends PreparedQuestion>(q: Q, rng: Rng): Q {
  if (q.kind === 'number') return q;
  if (q.kind === 'order') return { ...q, items: shuffle(q.items, rng) };
  const c = q as Question;
  const order = shuffle([0, 1, 2, 3], rng);
  return { ...c, options: order.map((i) => c.options[i]), answer: order.indexOf(c.answer) } as Q;
}

/** Unseen first (in random order), then the ones seen longest ago (or lowest in `seen`, whatever it ranks by). */
const leastSeenFirst = <T extends { id: string }>(pool: T[], seen: ReadonlyMap<string, number>, rng: Rng) =>
  shuffle(pool, rng).sort((a, b) => (seen.get(a.id) ?? 0) - (seen.get(b.id) ?? 0));

/**
 * A picture or order question (or a final in a match of one category) nobody in the match has seen for this long can
 * come again: there are fewer of them, and the same one every few matches would wear them out.
 */
const REPEAT_MS = 30 * 24 * 60 * 60_000;

/**
 * Unseen (or seen REPEAT_MS ago or more), least seen first. A ranking that isn't a time (the daily's, by how often each
 * was played) is far below any time: everything in it counts as unseen.
 */
const notRecent = <T extends { id: string }>(pool: T[], seen: ReadonlyMap<string, number>, rng: Rng, now: number) =>
  leastSeenFirst(pool, seen, rng).filter((q) => !seen.has(q.id) || seen.get(q.id)! <= now - REPEAT_MS);

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
 * `pool`: what to draw from (the bank's questions without a picture; a room of pictures draws from those).
 */
export function pickQuestions(
  count: number,
  category: CategoryChoice,
  seen: ReadonlyMap<string, number>,
  rng: Rng = Math.random,
  pool: readonly Question[] = questionBank(),
): Question[] {
  const ofCategory = pool.filter((q) => category === 'mixed' || q.category === category);
  // Shuffled first, so unseen questions (and ones seen in the same match) come in random order; the sort is stable.
  const ordered = leastSeenFirst(ofCategory, seen, rng);

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
 * Puts the first of `candidates` that fits in place of a question between `from` and `to` (indices into `questions`,
 * none of `taken`): one of its own difficulty if there is, else a neighbour's (easy for medium…), so the match still
 * ramps up. Returns the index it took, or null.
 */
function placeOne(
  questions: PreparedQuestion[],
  candidates: readonly PreparedQuestion[],
  from: number,
  to: number,
  taken: Set<number>,
  rng: Rng,
): number | null {
  const free: number[] = [];
  for (let i = Math.max(0, from); i <= Math.min(to, questions.length - 1); i++) if (!taken.has(i)) free.push(i);
  if (!free.length) return null;
  for (const gap of [0, 1]) {
    for (const c of candidates) {
      if (questions.some((q) => q.id === c.id)) continue;
      const fits = free.filter(
        (i) => Math.abs(DIFFICULTY_ORDER[questions[i].difficulty] - DIFFICULTY_ORDER[c.difficulty]) === gap,
      );
      if (!fits.length) continue;
      const at = fits[Math.floor(rng() * fits.length)];
      questions[at] = shuffled(c, rng);
      taken.add(at);
      return at;
    }
  }
  return null;
}

/**
 * A match's picture and order questions, in place of some of its questions with options: the pictures between Q2 and
 * Q8 (IMAGE: never the opener, whose picture there'd be no reveal to fetch during), the order question in the second
 * half. Only ones none of the players has seen for REPEAT_MS: when there are none, the match simply has fewer.
 */
function placeFormats(
  questions: PreparedQuestion[],
  category: CategoryChoice,
  seen: ReadonlyMap<string, number>,
  formats: Formats,
  rng: Rng,
  now: number,
) {
  const inCategory = (q: PlayableQuestion) => category === 'mixed' || q.category === category;
  const taken = new Set<number>();
  if (formats.order && questions.length >= 5) {
    const candidates = notRecent(orderBank().filter(inCategory), seen, rng, now);
    placeOne(questions, candidates, Math.floor(questions.length / 2), questions.length - 1, taken, rng);
  }
  const pictures = Math.min(formats.images, questions.length >= IMAGE.fullMatch ? IMAGE.perMatch : 1);
  if (pictures > 0 && questions.length >= 2) {
    const candidates = notRecent(imageBank().filter(inCategory), seen, rng, now);
    for (let n = 0; n < pictures; n++) {
      if (placeOne(questions, candidates, IMAGE.first, IMAGE.last, taken, rng) === null) break;
    }
  }
}

/**
 * A match's final: a number question, unseen first, then the one seen longest ago. In a match of one category only one
 * not seen for REPEAT_MS; null when there's none (the match then ends on a question with options). `not`: categories
 * the match plays otherwise.
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
  if (category !== 'mixed' && (seen.get(first.id) ?? 0) > (opts.now ?? Date.now()) - REPEAT_MS) return null;
  return first;
}

/**
 * A match's `count` questions, as pickQuestions picks them, with its pictures and order question (`formats`) in place
 * of some, the last one its final when it has one (pickFinal). `pictures`: a room of pictures — every question one, as
 * far as the bank has them (the rest with options).
 */
export function pickMatch(
  count: number,
  category: CategoryChoice,
  seen: ReadonlyMap<string, number>,
  opts: { final: boolean; formats?: Formats; pictures?: boolean; rng?: Rng; now?: number },
): PreparedQuestion[] {
  const rng = opts.rng ?? Math.random;
  const final = opts.final ? pickFinal(category, seen, rng) : null;
  const body = count - (final ? 1 : 0);
  let questions: PreparedQuestion[];
  if (opts.pictures) {
    const drawn = pickQuestions(body, category, seen, rng, imageBank());
    const rest = pickQuestions(body - drawn.length, category, seen, rng);
    questions = [...drawn, ...rest].sort((a, b) => DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty]);
  } else {
    questions = pickQuestions(body, category, seen, rng);
    placeFormats(questions, category, seen, opts.formats ?? TEXT_ONLY, rng, opts.now ?? Date.now());
  }
  return final ? [...questions, final] : questions;
}

/** One round of a match in ROUNDS: drawn (`category`), or picked from `offers` when it comes. */
export interface RoundPlan {
  from: number;
  size: number;
  category: CategoryId | null;
  /** The categories on offer and the questions each would bring (drawn up front: the match never waits on the bank). */
  offers: { category: CategoryId; questions: PreparedQuestion[] }[];
}

/**
 * `difficulties.length` questions of one category, unseen first, none of `used` (which they join). Round `round` of
 * ROUNDS (`from`: its first question's index) may hold a picture (the first two rounds) or an order question (the
 * third), as `formats` allow.
 */
function drawFrom(
  category: CategoryId,
  difficulties: readonly Difficulty[],
  seen: ReadonlyMap<string, number>,
  used: Set<string>,
  rng: Rng,
  round?: { index: number; from: number; formats: Formats; now: number },
): PreparedQuestion[] | null {
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
  const questions: PreparedQuestion[] = picked.map((q) => shuffled(q, rng));
  if (round) {
    const { index, from, formats, now } = round;
    const fresh = <T extends PlayableQuestion>(bank: T[]) =>
      notRecent(
        bank.filter((q) => q.category === category && !used.has(q.id)),
        seen,
        rng,
        now,
      );
    const taken = new Set<number>();
    if (index === ROUNDS.count - 1 && formats.order) placeOne(questions, fresh(orderBank()), 0, 2, taken, rng);
    else if (index < Math.min(2, formats.images))
      placeOne(questions, fresh(imageBank()), IMAGE.first - from, IMAGE.last - from, taken, rng);
  }
  for (const q of questions) used.add(q.id);
  return questions;
}

/**
 * A match in ROUNDS (Дуел): the first round drawn, the questions of every category on offer for the later ones, and
 * a final from a category none of them plays. Until a round is picked, `questions` holds its first offer. Null when
 * the bank is too thin for it.
 */
export function pickRounds(
  seen: ReadonlyMap<string, number>,
  rng: Rng = Math.random,
  /** `final`: a number final (else a hard question closes the match: a room that turned it off). */
  {
    final: numberFinal = true,
    formats = TEXT_ONLY,
    now = Date.now(),
  }: { final?: boolean; formats?: Formats; now?: number } = {},
): { questions: PreparedQuestion[]; rounds: RoundPlan[] } | null {
  const used = new Set<string>();
  const final = numberFinal ? pickFinal('mixed', seen, rng) : null;
  const categories = shuffle(
    CATEGORY_IDS.filter((c) => c !== final?.category),
    rng,
  );
  let next = 0;
  const offersFor = (round: number, wanted: number) => {
    const offers: RoundPlan['offers'] = [];
    while (offers.length < wanted && next < categories.length) {
      const category = categories[next++];
      const questions = drawFrom(category, ROUNDS.difficulty[round], seen, used, rng, {
        index: round,
        from: round * ROUNDS.size,
        formats,
        now,
      });
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
 * A friend duel's questions: ROUNDS of three, each on one category — `categories` if given (a rematch picked by whoever
 * lost the last one), else drawn — and a final from a category of its own. Nobody picks while it's played: the two
 * play it at different times. Pictures and an order question as in a live Дуел (`formats`).
 */
export function pickDuelSet(
  seen: ReadonlyMap<string, number>,
  categories: readonly CategoryId[] = [],
  rng: Rng = Math.random,
  { formats = TEXT_ONLY, now = Date.now() }: { formats?: Formats; now?: number } = {},
): PreparedQuestion[] | null {
  const used = new Set<string>();
  const drawn = shuffle(
    CATEGORY_IDS.filter((c) => !categories.includes(c)),
    rng,
  );
  const played: CategoryId[] = [];
  const questions: PreparedQuestion[] = [];
  for (let r = 0; r < ROUNDS.count; r++) {
    let round: PreparedQuestion[] | null = null;
    while (!round) {
      const category = categories[r] ?? drawn.shift();
      if (!category) return null;
      round = drawFrom(category, ROUNDS.difficulty[r], seen, used, rng, {
        index: r,
        from: r * ROUNDS.size,
        formats,
        now,
      });
      if (round) played.push(category);
      else if (categories[r]) return null;
    }
    questions.push(...round);
  }
  let closing: PreparedQuestion | null = pickFinal('mixed', seen, rng, { not: played });
  while (!closing && drawn.length) closing = drawFrom(drawn.shift()!, ['hard'], seen, used, rng)?.[0] ?? null;
  return closing ? [...questions, closing] : null;
}

/**
 * The same questions with the options (and an order question's items) in an order of their own for this seed (e.g. a
 * day and a player): a set everyone plays stays the same, but "the answers were Б, А, Г…" gives nothing away. The seed
 * is mixed with this server's own secret: the code is public, and without it one player's order would convert into
 * anyone else's.
 */
export function reorderOptions(questions: PreparedQuestion[], seed: string): PreparedQuestion[] {
  const secret = installationSecret('option-order');
  return questions.map((q) => shuffled(q, seededRng(`${secret}:${seed}:${q.id}`)));
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

/**
 * When any of these players last saw each question they saw recently — and today's daily questions as seen just now,
 * by everyone: held back from every other pick until midnight, or a Соло could show one before its player's daily.
 */
export function recentFor(userIds: number[]): Map<string, number> {
  const seen = new Map(
    userIds.length
      ? all<{ question_id: string; seen_at: number }>(
          `SELECT question_id, MAX(seen_at) AS seen_at FROM seen_questions
           WHERE user_id IN (${userIds.map(() => '?').join(',')}) GROUP BY question_id`,
          ...userIds,
        ).map((r) => [r.question_id, r.seen_at])
      : [],
  );
  const now = Date.now();
  for (const id of todaysDaily()) seen.set(id, now);
  return seen;
}

/** Today's daily questions (daily.ts draws them, and says how: holdBackDaily); none until it does. */
let todaysDaily: () => readonly string[] = () => [];
export function holdBackDaily(today: () => readonly string[]) {
  todaysDaily = today;
}
