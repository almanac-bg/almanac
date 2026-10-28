// Measured difficulty and skill (skill.ts), finished runs as they're kept (runs.ts), and the bank's formats the game
// doesn't play yet (questions.ts).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { PowerupId } from '@quiz/shared';
import { writeFixtureQuestions } from './helpers';

// Server modules open the database on import — point them at a throwaway one first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-skill-'));
process.env.DB_PATH = path.join(tmp, 'skill.db');
process.env.QUESTIONS_PATH = path.join(tmp, 'questions.json');
writeFixtureQuestions(process.env.QUESTIONS_PATH);
const { one, run } = await import('../src/db');
const { expectedRight, playerSkill, questionRating, recordSkill, seedSkillOnce, SKILL } = await import('../src/skill');
const { pruneRuns, recordRun, RUN_KEEP_DAYS } = await import('../src/runs');
const { bankProblem, pickQuestions, questionBank, questionById, reloadQuestionBank, waitingFormats } = await import(
  '../src/questions'
);

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

run(
  `INSERT INTO users (id, username, username_key, password_hash, created_at)
   VALUES (1, 'a', 'a', 'x', 0), (2, 'b', 'b', 'x', 0), (3, 'c', 'c', 'x', 0), (4, 'd', 'd', 'x', 0)`,
);

type Q = ReturnType<typeof questionBank>[number];
const entry = (q: Q, correct: boolean, powerup: PowerupId | null = null) => ({
  questionId: q.id,
  index: 0,
  category: q.category,
  difficulty: q.difficulty,
  choice: correct ? q.answer : (q.answer + 1) % 4,
  correct,
  timeMs: 3000,
  points: correct ? 900 : 0,
  powerup,
});
const byDifficulty = (d: Q['difficulty']) => questionBank().filter((q) => q.difficulty === d);

test('level with a question, a player gets it right half the time; 400 points ahead, ten times in eleven', () => {
  assert.equal(expectedRight(1000, 1000), 0.5);
  assert.ok(Math.abs(expectedRight(1400, 1000) - 10 / 11) < 1e-9);
  assert.ok(Math.abs(expectedRight(1000, 1400) - 1 / 11) < 1e-9);
});

test('a hard question answered lifts the player and lowers the question; an easy one missed, the other way', () => {
  const [hard] = byDifficulty('hard');
  recordSkill(1, [entry(hard, true)]);
  assert.ok(playerSkill(1).rating > SKILL.start, 'the player goes up');
  assert.ok(playerSkill(1, hard.category).rating > SKILL.start, 'in that category too');
  assert.ok(questionRating(hard.id, 'hard').rating < SKILL.questionStart.hard, 'the question looks easier');

  const [easy] = byDifficulty('easy');
  recordSkill(2, [entry(easy, false)]);
  assert.ok(playerSkill(2).rating < SKILL.start);
  assert.ok(questionRating(easy.id, 'easy').rating > SKILL.questionStart.easy, 'the question looks harder');
  // The surprise sets the size: an easy one answered, as expected, moves a player far less than a hard one did.
  recordSkill(4, [entry(byDifficulty('easy')[1], true)]);
  assert.ok(playerSkill(4).rating - SKILL.start < (playerSkill(1).rating - SKILL.start) / 2);
});

test('an answer helped by 50/50 or a second try moves nothing; one with more time or a bet does', () => {
  const q = byDifficulty('medium')[3];
  const before = playerSkill(2).rating;
  recordSkill(2, [entry(q, true, 'fifty'), entry(q, true, 'retry')]);
  assert.equal(playerSkill(2).rating, before);
  assert.equal(questionRating(q.id, 'medium').answers, 0);
  recordSkill(2, [entry(q, true, 'double'), entry(byDifficulty('medium')[4], true, 'time')]);
  assert.notEqual(playerSkill(2).rating, before);
});

test('on the first start, skill is filled from the answers logged before it, once', () => {
  const q = byDifficulty('hard')[5];
  for (let i = 0; i < 3; i++)
    run(
      `INSERT INTO answers (user_id, match_id, question_id, difficulty, correct, time_ms, answered_at)
       VALUES (3, 'm', ?, 'hard', 1, 4000, ?)`,
      q.id,
      1_000 + i,
    );
  seedSkillOnce();
  assert.equal(playerSkill(3).answers, 3);
  assert.ok(playerSkill(3).rating > SKILL.start);
  seedSkillOnce();
  assert.equal(playerSkill(3).answers, 3, 'not twice');
});

test('a run keeps every answer with the option as the bank orders it; a year on, it goes', async () => {
  const q = questionBank()[0];
  recordRun(
    {
      matchId: 'match-1',
      userId: 1,
      mode: 'duel',
      category: 'mixed',
      rating: 1040,
      score: 1700,
      correct: 1,
      log: [
        { ...entry(q, true), index: 0 },
        { ...entry(questionBank()[1], false, 'fifty'), index: 1, timeMs: null },
      ],
    },
    Date.now() - (RUN_KEEP_DAYS + 1) * 24 * 60 * 60_000,
  );
  recordRun({
    matchId: 'match-2',
    userId: 1,
    mode: 'solo',
    category: 'history',
    rating: null,
    score: 0,
    correct: 0,
    log: [],
  });
  const kept = one<{ answers: string; rating: number }>("SELECT answers, rating FROM runs WHERE match_id = 'match-1'")!;
  assert.equal(kept.rating, 1040);
  const answers = JSON.parse(kept.answers);
  assert.deepEqual(answers[0], { q: q.id, i: 0, c: q.answer, ok: 1, t: 3000, p: 900, k: null });
  assert.equal(answers[1].k, 'fifty');
  assert.equal(answers[1].t, null);
  assert.equal(await pruneRuns(), 1);
  assert.ok(one("SELECT 1 AS x FROM runs WHERE match_id = 'match-2'"), 'a recent one stays');
});

test('the bank holds number, order and picture questions; matches play only what the game can show', () => {
  const file = process.env.QUESTIONS_PATH!;
  const good = fs.readFileSync(file, 'utf8');
  const bank = JSON.parse(good);
  bank.push(
    {
      id: 'history-n1',
      kind: 'number',
      category: 'history',
      difficulty: 'medium',
      q: 'През коя година е Освобождението?',
      number: { answer: 1878, unit: '', min: 1000, max: 2025, step: 1, scale: 'linear', tolerance: 30 },
      tags: ['bg'],
      added: '2026-10-28',
    },
    {
      id: 'history-o1',
      kind: 'order',
      category: 'history',
      difficulty: 'hard',
      q: 'Подреди от най-старото',
      items: [
        { text: 'А', value: 1 },
        { text: 'Б', value: 2 },
        { text: 'В', value: 3 },
        { text: 'Г', value: 4 },
      ],
      direction: 'asc',
    },
    {
      id: 'geography-i1',
      category: 'geography',
      difficulty: 'easy',
      q: 'Чие е това знаме?',
      options: ['А', 'Б', 'В', 'Г'],
      answer: 0,
      image: {
        file: '9f2c1a.webp',
        w: 1200,
        h: 800,
        alt: 'Знаме с три ивици',
        credit: 'Wikimedia Commons',
        license: 'PD',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.svg',
      },
    },
  );
  fs.writeFileSync(file, JSON.stringify(bank));
  try {
    reloadQuestionBank();
    assert.deepEqual(waitingFormats(), { number: 1, order: 1, image: 1 });
    const ids = new Set(questionBank().map((q) => q.id));
    assert.ok(!ids.has('history-n1') && !ids.has('history-o1') && !ids.has('geography-i1'), 'none drawn yet');
    assert.ok(!pickQuestions(30, 'geography', new Map()).some((q) => q.id === 'geography-i1'));
    assert.equal(questionById('geography-i1')?.image?.license, 'PD', 'but known by id');

    // A broken one says which, and why.
    bank.push({ ...bank.at(-3), id: 'history-n2', number: { ...bank.at(-3).number, answer: 3000 } });
    fs.writeFileSync(file, JSON.stringify(bank));
    reloadQuestionBank();
    assert.match(bankProblem() ?? '', /history-n2: number.*outside min–max/);
  } finally {
    fs.writeFileSync(file, good);
  }
  reloadQuestionBank();
  assert.equal(bankProblem(), null);
});
