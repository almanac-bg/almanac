// Guards the question banks: the public sample, and the private bank when this checkout has it. Every batch of new
// questions has to pass this.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { CATEGORY_IDS } from '@quiz/shared';

interface Q {
  id: string;
  /** Four options (the default), a number to guess, or four things to put in order: see the schemas in questions.ts. */
  kind?: 'choice' | 'number' | 'order';
  category: string;
  difficulty: string;
  q: string;
  options: string[];
  answer: number;
  number?: { answer: number; unit: string; min: number; max: number; step: number; scale: string; tolerance: number };
  items?: { text: string; value: number }[];
  direction?: 'asc' | 'desc';
  unit?: string;
  image?: {
    file: string;
    w: number;
    h: number;
    alt: string;
    credit: string;
    license: string;
    licenseVersion?: string;
    sourceUrl: string;
  };
  fact?: string;
  factSource?: string;
}

/** A WebP's size, from its header (VP8, VP8L or VP8X). */
function webpSize(b: Buffer): { w: number; h: number } | null {
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  return null;
}

const BANKS = [
  // Just enough to play every mode while developing.
  {
    name: 'public sample',
    file: '../src/data/questions.sample.json',
    perCategory: 12,
    perDifficulty: 2,
    numbersPerCategory: 2,
    balanced: false,
  },
  {
    name: 'private bank',
    file: '../../../private/questions.json',
    perCategory: 30,
    perDifficulty: 6,
    numbersPerCategory: 8,
    balanced: true,
  },
]
  .map((b) => ({ ...b, file: path.join(import.meta.dirname, b.file) }))
  .filter((b) => fs.existsSync(b.file));
const PREFIX: Record<string, string> = {
  general: 'gen',
  science: 'sci',
  history: 'his',
  geography: 'geo',
  movies: 'mov',
  music: 'mus',
  sports: 'spo',
  technology: 'tec',
  literature: 'lit',
  nature: 'nat',
};
/** "1 492", "30,48", "88 мили в час" → the number and what follows it; null when an option isn't a number. */
function asNumber(option: string): { value: number; unit: string } | null {
  const m = /^\s*(?:около\s+)?([−-]?\d[\d\s\u00a0\u202f.,]*)\s*(.*)$/u.exec(option);
  if (!m) return null;
  let digits = m[1].replace(/[\s\u00a0\u202f]/g, '');
  const [, decimals] = digits.split(',');
  digits =
    decimals !== undefined && decimals.length !== 3 && !digits.includes('.')
      ? digits.replace(',', '.')
      : digits.replace(/,/g, '');
  const value = Number(digits.replace('−', '-'));
  return Number.isFinite(value) ? { value, unit: m[2].trim() } : null;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** The mix every match draws (pickQuestions): a bank with the same split wears its difficulties out evenly. */
const SHARE = { easy: 0.4, medium: 0.4, hard: 0.2 } as const;

/** Words every other question has: two questions sharing them aren't on the same subject (as in the bank tool). */
const COMMON = new Set([
  'колко',
  'която',
  'което',
  'които',
  'какво',
  'какъв',
  'каква',
  'какви',
  'годин',
  'чийто',
  'чиято',
  'бълга',
]);

/** Rough word stems (the first five letters of each word of five or more), as the bank tool compares questions. */
const stems = (s: string) =>
  new Set(
    normalize(s)
      .split(' ')
      .filter((w) => w.length >= 5 && !/^\d+$/.test(w))
      .map((w) => w.slice(0, 5))
      .filter((w) => !COMMON.has(w)),
  );

for (const { name, file, perCategory, perDifficulty, numbersPerCategory, balanced } of BANKS) {
  const everything = JSON.parse(fs.readFileSync(file, 'utf8')) as Q[];
  // The rules below are for four-option questions (pictures with them, `withOptions`; their balance and spread for
  // those without, `bank`); numbers, pictures and orders have their own further down. The server's schemas check the
  // rest when it loads the bank.
  const withOptions: Q[] = everything.filter((q) => (q.kind ?? 'choice') === 'choice');
  const bank = withOptions.filter((q) => !q.image);
  const pictures = withOptions.filter((q) => q.image);
  const numbers = everything.filter((q) => q.kind === 'number');
  const orders = everything.filter((q) => q.kind === 'order');

  test(`${name}: every question is well-formed`, () => {
    for (const q of withOptions) {
      const where = `${q.id}: ${q.q}`;
      assert.ok(CATEGORY_IDS.includes(q.category as never), `${where} — unknown category`);
      assert.ok(q.id.startsWith(`${PREFIX[q.category]}-`), `${where} — id prefix doesn't match category`);
      assert.ok(['easy', 'medium', 'hard'].includes(q.difficulty), `${where} — bad difficulty`);
      assert.ok(q.q.trim().length >= 10 && q.q.length <= 150, `${where} — question length`);
      assert.equal(q.options.length, 4, `${where} — needs 4 options`);
      for (const o of q.options) assert.ok(o.trim().length > 0 && o.length <= 45, `${where} — option "${o}" length`);
      assert.equal(new Set(q.options.map((o) => normalize(o))).size, 4, `${where} — options must differ`);
      assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3, `${where} — answer index`);
    }
  });

  test(`${name}: ids and question texts are unique`, () => {
    const ids = new Set<string>();
    const texts = new Map<string, string>();
    for (const q of everything) {
      assert.ok(!ids.has(q.id), `duplicate id ${q.id}`);
      ids.add(q.id);
    }
    // „Чие е това знаме?“ is many questions: a picture's question is its text with its picture.
    for (const q of withOptions) {
      const key = `${normalize(q.q)} ${q.image?.file ?? ''}`;
      assert.ok(!texts.has(key), `duplicate question: ${q.id} and ${texts.get(key)}`);
      texts.set(key, q.id);
    }
  });

  // The goal is every category the same size, each split 40/40/20 like a match (new batches fill the gaps that
  // `bank.mjs stats` shows); this keeps the drift small. Not for the sample: 12 questions a category is too few.
  test(`${name}: categories and difficulties stay balanced`, { skip: !balanced }, () => {
    const sizes = new Map(CATEGORY_IDS.map((c) => [c, bank.filter((q) => q.category === c).length]));
    const largest = Math.max(...sizes.values());
    for (const [category, size] of sizes) {
      assert.ok(size >= largest * 0.9, `${category} has ${size} questions, the largest category ${largest}`);
      for (const [difficulty, share] of Object.entries(SHARE)) {
        const n = bank.filter((q) => q.category === category && q.difficulty === difficulty).length;
        assert.ok(
          Math.abs(n / size - share) <= 0.05,
          `${category}: ${n} of ${size} ${difficulty} (aim ${share * 100}%)`,
        );
      }
    }
  });

  test(`${name}: every category can fill any match`, () => {
    for (const category of CATEGORY_IDS) {
      const qs = bank.filter((q) => q.category === category);
      assert.ok(qs.length >= perCategory, `${category} has only ${qs.length} questions`);
      for (const d of ['easy', 'medium', 'hard']) {
        assert.ok(
          qs.filter((q) => q.difficulty === d).length >= perDifficulty,
          `${category} needs at least ${perDifficulty} ${d} questions`,
        );
      }
    }
  });

  // A player who learns that the right number is never the smallest or the largest of four halves every numeric
  // question; in a fair bank about half the right numbers are one or the other.
  test(`${name}: a numeric answer isn't always one of the middle values`, () => {
    const numeric = bank.flatMap((q) => {
      const parsed = q.options.map(asNumber);
      if (parsed.some((p) => p === null) || new Set(parsed.map((p) => p!.unit)).size > 1) return [];
      const values = parsed.map((p) => p!.value);
      return new Set(values).size === 4 ? [{ q, values }] : [];
    });
    if (numeric.length < 20) return;
    const extreme = numeric.filter(({ q, values }) =>
      [Math.min(...values), Math.max(...values)].includes(values[q.answer]),
    );
    const share = extreme.length / numeric.length;
    assert.ok(share >= 0.35, `only ${extreme.length} of ${numeric.length} numeric answers are the smallest or largest`);
  });

  test(`${name}: every "Знаеше ли?" fact is short, sourced, and gives no other question away`, () => {
    const words = (s: string) =>
      new Set(
        normalize(s)
          .split(/[^\p{L}\p{N}]+/u)
          .filter((w) => w.length >= 5),
      );
    // Normalized once: the loop below compares every fact with every answer (thousands × thousands).
    const answers = withOptions
      .map((other) => ({ other, answer: normalize(other.options[other.answer]) }))
      .filter(({ answer }) => answer.length >= 4);
    // A number question is a match's final, last: what its fact says comes after every other question (its own rules
    // are further down).
    for (const q of everything) {
      if (q.fact === undefined || q.kind === 'number') continue;
      const where = `${q.id}: ${q.fact}`;
      assert.ok(q.fact.trim().length >= 20 && q.fact.length <= 200, `${where} — length (20–200)`);
      assert.match(q.fact, /[.!?…“"]$/, `${where} — a finished sentence`);
      assert.ok(q.factSource && new URL(q.factSource).protocol === 'https:', `${where} — needs an https source`);
      // Shown after its own question, but a later one in the same match may be about the same thing.
      const fact = normalize(q.fact);
      const factWords = words(q.fact);
      for (const { other, answer } of answers) {
        if (other === q || !fact.includes(answer)) continue;
        const shared = [...words(other.q)].filter((w) => factWords.has(w));
        assert.ok(shared.length < 2, `${where} — gives away ${other.id} (${other.q} → ${answer}; shares ${shared})`);
      }
    }
  });

  test(`${name}: correct answers are spread across positions`, () => {
    // Options are shuffled at runtime anyway; a skewed file usually means a copy-paste slip.
    const counts = [0, 0, 0, 0];
    for (const q of bank) counts[q.answer]++;
    for (const c of counts)
      assert.ok(c / bank.length > 0.15 && c / bank.length < 0.35, `answer distribution ${counts}`);
  });

  test(`${name}: number questions are well-formed, and none is the text of another question`, () => {
    const texts = new Set(everything.filter((q) => q.kind !== 'number').map((q) => normalize(q.q)));
    const ids = new Set(everything.filter((q) => q.kind !== 'number').map((q) => q.id));
    for (const q of numbers) {
      const n = q.number!;
      const where = `${q.id}: ${q.q}`;
      assert.ok(q.id.startsWith(`${PREFIX[q.category]}-`) && !ids.has(q.id), `${where} — id`);
      ids.add(q.id);
      assert.ok(q.q.trim().length >= 10 && q.q.length <= 150 && q.q.endsWith('?'), `${where} — question`);
      assert.ok(!texts.has(normalize(q.q)), `${where} — the same text as another question`);
      texts.add(normalize(q.q));
      assert.ok(n.unit.length <= 12, `${where} — unit`);
      // Whole steps from zero: the keypad and the "exact" bonus work in steps.
      assert.ok(Math.abs(n.answer / n.step - Math.round(n.answer / n.step)) < 1e-6, `${where} — answer not in steps`);
      // The range is no clue: the answer isn't the middle of a narrow one.
      if (n.scale === 'linear')
        assert.ok(n.max - n.min >= 3 * n.tolerance, `${where} — the range is narrow for its tolerance`);
      // A tolerance that lets a wild guess score, or no near miss: neither is a final.
      if (n.scale === 'linear') assert.ok(n.tolerance >= 2 * n.step, `${where} — tolerance under two steps`);
      else assert.ok(n.tolerance <= 10, `${where} — a log tolerance over ×10`);
      // Its number isn't in its own text.
      assert.ok(!normalize(q.q).split(' ').includes(String(n.answer)), `${where} — the answer is in the question`);
      if (q.fact) {
        assert.ok(q.fact.trim().length >= 20 && q.fact.length <= 200, `${where} — fact length (20–200)`);
        assert.ok(q.factSource && new URL(q.factSource).protocol === 'https:', `${where} — fact needs an https source`);
      }
    }
  });

  // A picture is the question: free to use (the licences IMAGE allows), in both sizes and light enough for a phone,
  // described for screen readers without its answer, and short to read beside it.
  test(`${name}: picture questions are well-formed, free to use, and their pictures are there`, () => {
    const dir = path.join(path.dirname(file), 'images');
    const files = new Map<string, string>();
    for (const q of pictures) {
      const image = q.image!;
      const where = `${q.id}: ${q.q}`;
      assert.ok(q.q.length <= 60 && q.q.endsWith('?'), `${where} — a picture's question is short (≤ 60)`);
      for (const o of q.options) assert.ok(o.length <= 25, `${where} — option "${o}" over 25 (a 2×2 grid)`);
      assert.ok(['PD', 'CC0', 'CC BY', 'CC BY-SA'].includes(image.license), `${where} — licence`);
      assert.ok(image.license === 'PD' || /^[1-4]\.[05]$/.test(image.licenseVersion ?? ''), `${where} — its version`);
      assert.ok(image.credit.trim() && new URL(image.sourceUrl).protocol === 'https:', `${where} — credit and source`);
      assert.ok(image.alt.trim().length >= 3 && image.alt.length <= 150, `${where} — alt text`);
      const answer = normalize(q.options[q.answer]);
      assert.ok(
        answer.length < 4 || !normalize(image.alt).includes(answer),
        `${where} — the alt text names the answer`,
      );
      assert.ok(!files.has(image.file), `${where} — the same picture as ${files.get(image.file)}`);
      files.set(image.file, q.id);
      for (const f of [image.file, image.file.replace(/\.webp$/, '-600.webp')]) {
        const at = path.join(dir, f);
        assert.ok(fs.existsSync(at), `${where} — ${f} isn't in ${path.relative(process.cwd(), dir)}`);
        assert.ok(fs.statSync(at).size <= 150_000, `${where} — ${f} is over 150 KB`);
      }
      const size = webpSize(fs.readFileSync(path.join(dir, image.file)));
      assert.deepEqual(size, { w: image.w, h: image.h }, `${where} — its size isn't what the bank says`);
      assert.ok(Math.max(image.w, image.h) <= 1200, `${where} — over 1200 px`);
    }
  });

  // Four things of a kind, far enough apart to be told apart, the way to order them in the question.
  test(`${name}: order questions are well-formed`, () => {
    const texts = new Set<string>();
    for (const q of orders) {
      const items = q.items!;
      const where = `${q.id}: ${q.q}`;
      assert.ok(q.q.trim().length >= 10 && q.q.length <= 110, `${where} — question length (10–110)`);
      assert.ok(!texts.has(normalize(q.q) + items.map((i) => i.text).join()), `${where} — a duplicate`);
      texts.add(normalize(q.q) + items.map((i) => i.text).join());
      assert.equal(items.length, 4, `${where} — four items`);
      assert.equal(new Set(items.map((i) => normalize(i.text))).size, 4, `${where} — items must differ`);
      for (const i of items) assert.ok(i.text.trim() && i.text.length <= 30, `${where} — item "${i.text}" over 30`);
      assert.ok(q.direction === 'asc' || q.direction === 'desc', `${where} — direction`);
      assert.ok((q.unit ?? '').length <= 12, `${where} — unit`);
      const values = items.map((i) => i.value).sort((a, b) => a - b);
      for (let k = 1; k < values.length; k++) {
        const gap = values[k] - values[k - 1];
        assert.ok(
          gap >= 3 || gap / Math.max(Math.abs(values[k]), Math.abs(values[k - 1])) >= 0.1,
          `${where} — ${values[k - 1]} and ${values[k]} are too close to tell apart`,
        );
      }
    }
  });

  // Pictures and orders are balanced on their own, as the numbers are: every category as many.
  test(`${name}: pictures and orders are even across the categories`, { skip: !balanced }, () => {
    for (const [format, questions] of [
      ['picture', pictures],
      ['order', orders],
    ] as const) {
      const counts = CATEGORY_IDS.map((c) => questions.filter((q) => q.category === c).length);
      assert.equal(Math.min(...counts), Math.max(...counts), `${format} questions uneven: ${counts.join(' ')}`);
    }
  });

  // A final is one question a match, drawn from any category: every category has as many (and enough of them).
  test(`${name}: every category has its number questions`, () => {
    const counts = CATEGORY_IDS.map((c) => numbers.filter((q) => q.category === c).length);
    for (const [i, c] of CATEGORY_IDS.entries())
      assert.ok(counts[i] >= numbersPerCategory, `${c} has ${counts[i]} number questions`);
    if (balanced) assert.equal(Math.min(...counts), Math.max(...counts), `uneven: ${counts.join(' ')}`);
  });

  // A final comes last, so nothing it says gives an earlier question away; but an earlier question (or its fact,
  // shown after it) that names the final's number on the same subject would give the final away.
  test(`${name}: no question or fact gives a final's number away`, () => {
    for (const q of numbers) {
      const answer = String(q.number!.answer).replace('.', ',');
      if (answer.length < 3) continue; // "24", "7": too common to judge by the digits
      const words = stems(q.q);
      for (const other of everything) {
        if (other === q) continue;
        const text = ` ${normalize(`${other.q} ${other.fact ?? ''}`)} `;
        if (!text.includes(` ${normalize(answer)} `)) continue;
        const shared = [...stems(`${other.q} ${other.fact ?? ''}`)].filter((w) => words.has(w));
        assert.ok(shared.length < 2, `${other.id} gives away ${q.id} (${q.q} → ${answer}; shares ${shared})`);
      }
    }
  });
}
