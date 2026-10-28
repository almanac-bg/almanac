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
  fact?: string;
  factSource?: string;
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
  // The rules below are for four-option questions; number questions (a match's final) have their own further down.
  // The other formats are checked by the server's schemas when it loads the bank.
  const bank: Q[] = everything.filter((q) => (q.kind ?? 'choice') === 'choice');
  const numbers = everything.filter((q) => q.kind === 'number');

  test(`${name}: every question is well-formed`, () => {
    for (const q of bank) {
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
    for (const q of bank) {
      assert.ok(!ids.has(q.id), `duplicate id ${q.id}`);
      ids.add(q.id);
      const key = normalize(q.q);
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
    for (const q of bank) {
      if (q.fact === undefined) continue;
      const where = `${q.id}: ${q.fact}`;
      assert.ok(q.fact.trim().length >= 20 && q.fact.length <= 200, `${where} — length (20–200)`);
      assert.match(q.fact, /[.!?…“"]$/, `${where} — a finished sentence`);
      assert.ok(q.factSource && new URL(q.factSource).protocol === 'https:', `${where} — needs an https source`);
      // Shown after its own question, but a later one in the same match may be about the same thing.
      const factWords = words(q.fact);
      for (const other of bank) {
        if (other === q) continue;
        const answer = normalize(other.options[other.answer]);
        if (answer.length < 4 || !normalize(q.fact).includes(answer)) continue;
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
