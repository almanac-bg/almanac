// Guards the question banks: the public sample, and the private bank when this checkout has it. Every batch of new
// questions has to pass this.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { CATEGORY_IDS } from '@quiz/shared';

interface Q {
  id: string;
  category: string;
  difficulty: string;
  q: string;
  options: string[];
  answer: number;
}

const BANKS = [
  // Just enough to play every mode while developing.
  { name: 'public sample', file: '../src/data/questions.sample.json', perCategory: 12, perDifficulty: 2 },
  { name: 'private bank', file: '../../../private/questions.json', perCategory: 30, perDifficulty: 6 },
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

for (const { name, file, perCategory, perDifficulty } of BANKS) {
  const bank: Q[] = JSON.parse(fs.readFileSync(file, 'utf8'));

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

  test(`${name}: correct answers are spread across positions`, () => {
    // Options are shuffled at runtime anyway; a skewed file usually means a copy-paste slip.
    const counts = [0, 0, 0, 0];
    for (const q of bank) counts[q.answer]++;
    for (const c of counts)
      assert.ok(c / bank.length > 0.15 && c / bank.length < 0.35, `answer distribution ${counts}`);
  });
}
