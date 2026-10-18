// Guards the built-in question bank: every batch of new questions has to pass this.
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

const bank: Q[] = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../src/data/questions.json'), 'utf8'));
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
const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

test('every question is well-formed', () => {
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

test('ids and question texts are unique', () => {
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

test('every category can fill any match', () => {
  for (const category of CATEGORY_IDS) {
    const qs = bank.filter((q) => q.category === category);
    assert.ok(qs.length >= 30, `${category} has only ${qs.length} questions`);
    for (const d of ['easy', 'medium', 'hard']) {
      assert.ok(qs.filter((q) => q.difficulty === d).length >= 6, `${category} needs at least 6 ${d} questions`);
    }
  }
});

test('correct answers are spread across positions', () => {
  // Options are shuffled at runtime anyway; a skewed file usually means a copy-paste slip.
  const counts = [0, 0, 0, 0];
  for (const q of bank) counts[q.answer]++;
  for (const c of counts) assert.ok(c / bank.length > 0.15 && c / bank.length < 0.35, `answer distribution ${counts}`);
});
