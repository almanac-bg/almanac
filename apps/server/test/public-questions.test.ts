// What the public pages show with its answer (the sample bank, the holiday quizzes) is never dealt from the real bank,
// under its own id or another (publicQuestions.ts; the 31 October review, SEC-1/COPY-1/BANK-2/LEGAL-1).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { writeFixtureQuestions } from './helpers';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-public-'));
process.env.DB_PATH = path.join(tmp, 'public.db');
process.env.QUESTIONS_PATH = path.join(tmp, 'questions.json');
writeFixtureQuestions(process.env.QUESTIONS_PATH);
const sample = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '../src/data/questions.sample.json'), 'utf8'),
) as { id: string; q: string; kind?: string }[];
const christmas = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '../../web/src/content/christmas.json'), 'utf8'),
) as { q: string; options: string[]; answer: number }[];
const fixture = JSON.parse(fs.readFileSync(process.env.QUESTIONS_PATH, 'utf8')) as Record<string, unknown>[];
const fromSample = sample.find((q) => !q.kind || q.kind === 'choice')!;
fs.writeFileSync(
  process.env.QUESTIONS_PATH,
  JSON.stringify([
    ...fixture,
    // A sample question under its own id, and a holiday page's under another (with its text a little differently set).
    { ...fromSample },
    {
      id: 'general-9001',
      category: 'general',
      difficulty: 'easy',
      q: `  ${christmas[0].q.toUpperCase()} `,
      options: christmas[0].options,
      answer: christmas[0].answer,
    },
  ]),
);
const { questionBank, questionById } = await import('../src/questions');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('the real bank’s copies of public questions are held back', () => {
  const ids = new Set(questionBank().map((q) => q.id));
  assert.ok(!ids.has(fromSample.id), 'the sample’s question, by its id');
  assert.ok(!ids.has('general-9001'), 'a holiday page’s, by its text');
  assert.equal(questionById('general-9001'), undefined);
  assert.ok(ids.size > 50, 'the rest plays');
});
