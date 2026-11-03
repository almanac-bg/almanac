// The question-bank skill's tool (.claude/skills/question-bank/bank.mjs) writes the banks, so what it writes is tested:
// on a copy of the public sample, new questions get the next free ids and keep every other line as it was; patches
// change or remove fields and refuse unknown ones; a workflow's checked batches are collected; balance is filled to
// the size asked and the rest kept as spares (the 31 October review, REPO-9).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const tool = path.resolve(import.meta.dirname, '../../../.claude/skills/question-bank/bank.mjs');
const sample = path.resolve(import.meta.dirname, '../src/data/questions.sample.json');

/** A folder of its own with a copy of the sample bank. */
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-tool-'));
  const bank = path.join(dir, 'bank.json');
  fs.copyFileSync(sample, bank);
  return { dir, bank, file: (name: string, value: unknown) => write(path.join(dir, name), value) };
}

function write(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

const bankTool = (...args: string[]) => {
  const r = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

type Q = Record<string, unknown> & { id: string };
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Q[];
const lines = (file: string) => fs.readFileSync(file, 'utf8').split('\n');

/** A new four-option question as a writer drafts it: no id. */
const draft = (category: string, difficulty: string, n: number) => ({
  category,
  difficulty,
  q: `Тестов въпрос ${category} номер ${n}?`,
  options: [`Първи ${n}`, `Втори ${n}`, `Трети ${n}`, `Четвърти ${n}`],
  answer: n % 4,
  answerSource: 'https://example.test/source',
});

test('add: the next free ids, the date it came in, and every line before it as it was', () => {
  const { bank, file } = scratch();
  const before = lines(bank);
  const added = bankTool('add', file('draft.json', [draft('history', 'easy', 1), draft('history', 'medium', 2)]), bank);
  assert.equal(added.status, 0, added.out);
  const after = read(bank);
  const fresh = after.slice(-2);
  assert.deepEqual(
    fresh.map((q) => q.id),
    ['his-902', 'his-903'],
  );
  assert.ok(fresh.every((q) => /^\d{4}-\d{2}-\d{2}$/.test(String(q.added))));
  // One question a line: the diff of a batch is its own lines (and the comma the last line before them takes),
  // nothing else restyled.
  const now = lines(bank);
  assert.equal(now.length, before.length + 2);
  assert.ok(before.every((line) => now.includes(line) || now.includes(`${line},`)));

  // An id that's taken, or a field the bank doesn't know, is refused, and the bank stays as it was.
  const taken = bankTool('add', file('taken.json', [{ ...draft('history', 'hard', 3), id: 'his-902' }]), bank);
  assert.notEqual(taken.status, 0);
  assert.match(taken.out, /his-902 is taken/);
  const odd = bankTool('add', file('odd.json', [{ ...draft('history', 'hard', 4), colour: 'red' }]), bank);
  assert.notEqual(odd.status, 0);
  assert.match(odd.out, /unknown fields colour/);
  assert.equal(read(bank).length, after.length);
});

test('edit: a patch changes and removes fields, tidies a fact, and refuses what the bank has no field for', () => {
  const { bank, file } = scratch();
  const [first, second] = read(bank).filter((q) => q.category === 'history');
  const patched = bankTool(
    'edit',
    file('patch.json', [
      { id: first.id, difficulty: 'hard', fact: 'Висок е 2925 м.' },
      { id: second.id, answerSource: null },
    ]),
    bank,
  );
  assert.equal(patched.status, 0, patched.out);
  const byId = new Map(read(bank).map((q) => [q.id, q]));
  assert.equal(byId.get(first.id)!.difficulty, 'hard');
  // The non-breaking space between a number and its unit (a narrow screen never splits „2925 / м“).
  assert.equal(byId.get(first.id)!.fact, 'Висок е 2925 м.');
  assert.ok(!('answerSource' in byId.get(second.id)!));

  const unknown = bankTool('edit', file('bad.json', [{ id: first.id, colour: 'red' }]), bank);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.out, /unknown field colour/);
  const missing = bankTool('edit', file('gone.json', [{ id: 'his-999', difficulty: 'easy' }]), bank);
  assert.notEqual(missing.status, 0);
});

test("collect: a workflow's checked batches, OK and FIX in, DROP out, each with its writer's tid", () => {
  const { dir } = scratch();
  const batches = path.join(dir, 'work');
  // Each with the writer's own id for it (the tid), which `similar` and `giveaways` name it by.
  write(path.join(batches, 'history-1', 'verified.json'), [
    { ...draft('history', 'easy', 1), tid: 'h1-1', verdict: 'OK' },
    { ...draft('history', 'medium', 2), tid: 'h1-2', verdict: 'DROP', why: 'two answers are right' },
    { ...draft('history', 'hard', 3), tid: 'h1-3', verdict: 'FIX', q: 'Тестов въпрос, поправен?' },
  ]);
  const out = path.join(dir, 'collected');
  const collected = bankTool('collect', batches, out);
  assert.equal(collected.status, 0, collected.out);
  const kept = read(`${out}.json`);
  assert.deepEqual(
    kept.map((q) => q.q),
    ['Тестов въпрос history номер 1?', 'Тестов въпрос, поправен?'],
  );
  // Only the bank's own fields go on; the checker's verdict and notes stay behind.
  assert.ok(kept.every((q) => !('verdict' in q) && !('why' in q)));
  assert.deepEqual(
    read(`${out}.tids.json`).map((q) => q.tid),
    ['h1-1', 'h1-3'],
  );
});

test('fill: exactly what each category and difficulty lacks for the size asked; the rest are spares', () => {
  const { bank, file } = scratch();
  const before = read(bank).length;
  // The sample has 12 a category (5 easy, 5 medium, 2 hard): 15 is 6 + 6 + 3, one of each more.
  const candidates = [
    { ...draft('general', 'easy', 1), tid: 'a1' },
    { ...draft('general', 'easy', 2), tid: 'a2' },
    { ...draft('general', 'medium', 3), tid: 'a3' },
    { ...draft('general', 'hard', 4), tid: 'a4' },
  ];
  const tids = file('cands.tids.json', candidates);
  const filled = bankTool('fill', tids, bank, '--size', '15');
  assert.equal(filled.status, 0, filled.out);
  const now = read(bank);
  assert.equal(now.length, before + 3);
  // Four-option questions without a picture: the ones balance counts (pictures, numbers and orders on their own).
  const general = now.filter((q) => q.category === 'general' && q.kind === undefined && !q.image);
  assert.deepEqual(
    ['easy', 'medium', 'hard'].map((d) => general.filter((q) => q.difficulty === d).length),
    [6, 6, 3],
  );
  assert.ok(now.every((q) => !('tid' in q)));
  const spares = read(tids.replace('.tids.json', '.spares.json'));
  assert.deepEqual(
    spares.map((q) => q.tid),
    ['a2'],
  );
  assert.match(filled.out, /still lacking: science \+1 easy/);
  // Not a multiple of 5: refused.
  assert.notEqual(bankTool('fill', tids, bank, '--size', '14').status, 0);
});
