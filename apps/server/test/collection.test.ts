// What a player builds up: „Моят алманах“ and „Поправителен“ (almanac.ts), category mastery (mastery.ts), groups and
// their weekly boards (groups.ts); and how everyone did, on a question (answers.ts) and on a day (daily.ts).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { CROWD, DAILY_FIELD, dayEndsAt, dayKey, GROUPS, MASTERY, REVIEW, shiftDay, weekStart } from '@quiz/shared';
import type { AnswerLogEntry } from '../src/game/Game';
import { writeFixtureQuestions } from './helpers';

// Server modules open the database on import — point them at a throwaway one first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-collection-'));
process.env.DB_PATH = path.join(tmp, 'collection.db');
process.env.QUESTIONS_PATH = path.join(tmp, 'questions.json');
writeFixtureQuestions(process.env.QUESTIONS_PATH);
const { all, one, run } = await import('../src/db');
const { questionById, reloadQuestionBank, reorderOptions } = await import('../src/questions');
const { crowdFor, recordAnswers } = await import('../src/answers');
const { almanacCategory, almanacOverview, factCount, learn, noteMatch, reviewQueue, reviewQuestions } = await import(
  '../src/almanac'
);
const { bestMastery, currentTier, forgetMasteryCutoffs, masteryCutoffs, settleMastery } = await import(
  '../src/mastery'
);
const groups = await import('../src/groups');
const { recordDailyResult } = await import('../src/daily');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let users = 0;
function account(name = `играч${users + 1}`) {
  users++;
  return Number(
    run(
      "INSERT INTO users (username, username_key, password_hash, created_at) VALUES (?, ?, 'x', 0)",
      name,
      name.toLowerCase(),
    ).lastInsertRowid,
  );
}

/** One answer as a match logs it: `choice` as the bank orders the options (null: none in time). */
function logged(questionId: string, correct: boolean, choice: number | null = null): AnswerLogEntry {
  const q = questionById(questionId)!;
  return {
    questionId,
    index: 0,
    category: q.category,
    difficulty: q.difficulty,
    choice: q.kind === 'number' ? null : (choice ?? (correct ? q.answer : (q.answer + 1) % 4)),
    guess: q.kind === 'number' ? (correct ? q.number.answer : q.number.min) : null,
    closeness: q.kind === 'number' ? (correct ? 1 : 0) : null,
    correct,
    timeMs: 3000,
    points: correct ? 900 : 0,
    powerup: null,
    retried: false,
  };
}

const DAY = 24 * 60 * 60_000;

test('„X% знаят“: each option’s share in the match’s own order, only once enough have answered', () => {
  const player = account();
  const bank = questionById('history-5')!;
  assert.ok(bank.kind !== 'number');
  // 20 right, 6 on the next option, 3 on the one after, one with no answer: 30 in all.
  const log = [
    ...Array.from({ length: 20 }, () => logged('history-5', true)),
    ...Array.from({ length: 6 }, () => logged('history-5', false, (bank.answer + 1) % 4)),
    ...Array.from({ length: 3 }, () => logged('history-5', false, (bank.answer + 2) % 4)),
  ];
  recordAnswers('m', player, log);
  const shown = reorderOptions([bank], 'crowd-test')[0];
  assert.ok(shown.kind !== 'number');
  assert.equal(crowdFor(shown), null, `fewer than ${CROWD.minAnswers}`);
  recordAnswers('m', player, [{ ...logged('history-5', false), choice: null, timeMs: null }]);
  const crowd = crowdFor(shown)!;
  assert.equal(crowd.answers, 30);
  assert.equal(crowd.known, 20 / 30);
  assert.equal(crowd.picks![shown.answer], 20 / 30, 'the right option, wherever this match shows it');
  assert.equal(crowd.picks![shown.options.indexOf(bank.options[(bank.answer + 1) % 4])], 6 / 30);
  assert.equal(
    crowd.picks!.reduce((a, b) => a + b),
    29 / 30,
    'no answer in time is the rest',
  );

  // A number: the share that came close.
  const number = questionById('music-n0')!;
  recordAnswers('m', player, [
    ...Array.from({ length: 24 }, () => logged('music-n0', true)),
    ...Array.from({ length: 6 }, () => logged('music-n0', false)),
  ]);
  assert.deepEqual(crowdFor(number), { known: 0.8, picks: null, answers: 30 });
});

test('„Моят алманах“: a fact is yours once you get its question right (or stop to read it)', () => {
  const player = account();
  // Even questions of the fixture bank have a fact; odd ones don't.
  const added = noteMatch(
    player,
    [logged('science-0', true), logged('science-1', true), logged('science-2', false), logged('science-4', true)],
    false,
  );
  assert.equal(added, 2, 'two right answers with a fact');
  assert.equal(learn(player, ['science-2']), 1, 'read in a run alone');
  assert.equal(learn(player, ['science-2', 'science-0']), 0, 'already theirs');
  assert.equal(factCount(player), 3);

  const overview = almanacOverview(player);
  const science = overview.categories.find((c) => c.category === 'science')!;
  assert.deepEqual([science.facts, science.total], [3, 15], 'every other question in the fixture bank has a fact');
  assert.equal(overview.recent.length, 3);
  const page = almanacCategory(player, 'science');
  assert.deepEqual(page.facts.map((f) => f.id).sort(), ['science-0', 'science-2', 'science-4']);
  assert.equal(page.facts.find((f) => f.id === 'science-0')!.answer, 'Верен ✓ 0');

  // A question hidden by a moderator leaves the almanac (and its count) with the bank.
  run("INSERT INTO hidden_questions (question_id, hidden_by, hidden_at) VALUES ('science-4', NULL, 0)");
  reloadQuestionBank();
  assert.equal(factCount(player), 2);
  run('DELETE FROM hidden_questions');
  reloadQuestionBank();
});

test('„Поправителен“: a miss comes back after 3, 7 and 21 days, and starts over when missed again', () => {
  const player = account();
  const now = Date.UTC(2026, 10, 2, 12);
  const misses = ['geography-2', 'geography-4', 'geography-6', 'geography-n0'];
  noteMatch(player, [...misses.map((id) => logged(id, false)), logged('geography-8', true)], false, now);
  assert.deepEqual(reviewQueue(player, now), { due: 0, waiting: 4, nextDueAt: now + 3 * DAY, ready: false });
  assert.equal(reviewQuestions(player, now + DAY), null, 'none due yet');

  const due = now + 3 * DAY;
  const set = reviewQuestions(player, due)!;
  assert.deepEqual(
    set.map((q) => q.id),
    ['geography-2', 'geography-4', 'geography-6', 'geography-n0'],
    'the number last',
  );
  // Right on three, wrong on one again.
  noteMatch(
    player,
    set.map((q) => logged(q.id, q.id !== 'geography-4')),
    true,
    due,
  );
  const steps = new Map(
    all<{ question_id: string; step: number; due_at: number }>(
      'SELECT question_id, step, due_at FROM review_queue WHERE user_id = ?',
      player,
    ).map((r) => [r.question_id, r]),
  );
  assert.deepEqual([steps.get('geography-2')!.step, steps.get('geography-2')!.due_at], [1, due + 7 * DAY]);
  assert.deepEqual([steps.get('geography-4')!.step, steps.get('geography-4')!.due_at], [0, due + 3 * DAY]);
  assert.equal(factCount(player), 3, 'geography-8 from the match, 2 and 6 now (the number has no fact)');

  // Right at every step: learned for good, out of the queue.
  let at = due;
  for (const days of REVIEW.afterDays.slice(1)) {
    at += days * DAY;
    noteMatch(player, [logged('geography-2', true)], true, at);
  }
  assert.equal(
    one('SELECT 1 AS x FROM review_queue WHERE user_id = ? AND question_id = ?', player, 'geography-2'),
    undefined,
  );

  // Missed again in an ordinary match: back to the first step.
  noteMatch(player, [logged('geography-6', false)], false, at);
  assert.deepEqual(
    {
      ...one<{ step: number; due_at: number }>(
        'SELECT step, due_at FROM review_queue WHERE user_id = ? AND question_id = ?',
        player,
        'geography-6',
      ),
    },
    { step: 0, due_at: at + 3 * DAY },
  );
});

test('„Поправителен“ plays the longest-due first, at most ten, and drops what is no longer played', () => {
  const player = account();
  const now = Date.UTC(2026, 10, 2, 12);
  for (let i = 0; i < 14; i++)
    run(
      'INSERT INTO review_queue (user_id, question_id, step, due_at) VALUES (?, ?, 0, ?)',
      player,
      `movies-${i}`,
      now - (14 - i) * 60_000,
    );
  run("INSERT INTO hidden_questions (question_id, hidden_by, hidden_at) VALUES ('movies-0', NULL, 0)");
  reloadQuestionBank();
  const set = reviewQuestions(player, now)!;
  assert.equal(set.length, REVIEW.size);
  assert.deepEqual(
    set.map((q) => q.id),
    Array.from({ length: 10 }, (_, i) => `movies-${i + 1}`),
  );
  assert.equal(reviewQueue(player, now).due, 13, 'the hidden one is gone from the queue');
  run('DELETE FROM hidden_questions');
  reloadQuestionBank();
});

test('category mastery: fixed skill while few are ranked, the top 50/20/5% after; once earned, kept', () => {
  forgetMasteryCutoffs();
  const player = account();
  const skill = (userId: number, rating: number, answers = 40) =>
    run(
      `INSERT INTO player_skill (user_id, category, rating, answers) VALUES (?, 'history', ?, ?)
       ON CONFLICT (user_id, category) DO UPDATE SET rating = excluded.rating, answers = excluded.answers`,
      userId,
      rating,
      answers,
    );
  skill(player, 1300, MASTERY.minAnswers - 1);
  assert.equal(currentTier(player, 'history'), null, 'not ranked yet');
  skill(player, 1300);
  assert.deepEqual(masteryCutoffs('history'), [1100, 1250, 1400]);
  assert.deepEqual(settleMastery(player, ['history', 'music']), [{ category: 'history', tier: 1 }]);
  assert.deepEqual(settleMastery(player, ['history']), [], 'once');
  assert.deepEqual({ ...bestMastery(player) }, { category: 'history', tier: 1 });

  // Fifty more ranked, rated 1000…1490: now the share decides.
  for (let i = 0; i < 50; i++) skill(account(), 1000 + i * 10);
  forgetMasteryCutoffs();
  const cutoffs = masteryCutoffs('history');
  // 51 ranked: the best 26, 11 and 3.
  assert.deepEqual(cutoffs, [1250, 1390, 1470]);
  skill(player, 1240);
  assert.equal(currentTier(player, 'history'), null);
  assert.deepEqual(settleMastery(player, ['history']), [], 'below the cut-off now, but Експерт stays earned');
  assert.equal(one<{ tier: number }>('SELECT tier FROM mastery WHERE user_id = ?', player)!.tier, 1);
  skill(player, 1480);
  assert.deepEqual(settleMastery(player, ['history']), [{ category: 'history', tier: 2 }]);
});

test('groups: an invite link, at most 200 in one and 5 per player; the owner hands over on leaving', () => {
  const owner = account('Учителка');
  assert.equal(groups.cleanGroupName('  10 ​„Б“   клас  '), '10 „Б“ клас');
  assert.equal(groups.cleanGroupName('x'), null);
  assert.equal(
    groups.cleanGroupName('Семейство 👨\u200d👩\u200d👧\u202e'),
    'Семейство 👨\u200d👩\u200d👧',
    'no bidi tricks',
  );
  const made = groups.createGroup(owner, '10 „Б“ клас');
  assert.ok(made.ok);
  const code = one<{ code: string }>('SELECT code FROM player_groups WHERE id = ?', made.id)!.code;

  const pupil = account('Ученик');
  assert.deepEqual(groups.groupPreview(code, pupil), {
    name: '10 „Б“ клас',
    members: 1,
    owner: 'Учителка',
    memberOf: null,
    full: false,
  });
  assert.deepEqual(groups.joinGroup(pupil, code), { ok: true, id: made.id });
  assert.equal(groups.groupPreview(code, pupil)!.memberOf, made.id);
  assert.equal(groups.joinGroup(pupil, 'nope').ok, false);

  for (let i = 1; i < GROUPS.perPlayer; i++) assert.ok(groups.createGroup(pupil, `Група ${i}`).ok);
  assert.equal(groups.createGroup(pupil, 'Още една').ok, false, `${GROUPS.perPlayer} at most`);

  // Full at 200.
  for (let i = 2; i < GROUPS.maxMembers; i++)
    run(
      'INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)',
      made.id,
      account(),
      Date.now() + i,
    );
  assert.equal(groups.joinGroup(account(), code).ok, false);
  assert.equal(groups.groupPreview(code, null)!.full, true);

  // Only the owner manages it; leaving hands it to the longest in it; the last one out takes it along.
  assert.equal(groups.manageGroup(made.id, pupil, { newCode: true }).ok, false);
  assert.ok(groups.manageGroup(made.id, owner, { newCode: true }).ok);
  assert.equal(groups.joinGroup(account(), code).ok, false, 'the old link is gone');
  groups.leaveGroup(made.id, owner);
  assert.equal(one<{ owner_id: number }>('SELECT owner_id FROM player_groups WHERE id = ?', made.id)!.owner_id, pupil);
  run('DELETE FROM group_members WHERE group_id = ? AND user_id <> ?', made.id, pupil);
  groups.leaveGroup(made.id, pupil);
  assert.equal(one('SELECT 1 AS x FROM player_groups WHERE id = ?', made.id), undefined);
});

test("a group's week: the best five dailies summed; its winner hears so, and wears the crown all the next week", () => {
  const now = Date.now();
  const monday = weekStart(dayKey(now));
  const lastMonday = shiftDay(monday, -7);
  const [mariya, ivan, petar] = [account('Мария'), account('Иван'), account('Петър')];
  const made = groups.createGroup(mariya, 'Офис 3');
  assert.ok(made.ok);
  run('UPDATE player_groups SET created_at = 0 WHERE id = ?', made.id);
  const code = one<{ code: string }>('SELECT code FROM player_groups WHERE id = ?', made.id)!.code;
  groups.joinGroup(ivan, code);
  groups.joinGroup(petar, code);
  const daily = (userId: number, day: string, score: number) =>
    run(
      `INSERT INTO daily_results (user_id, day, started_at, finished_at, score, correct, time_ms)
       VALUES (?, ?, 0, 1, ?, 7, 30000)`,
      userId,
      day,
      score,
    );
  // Last week: Mария seven days (the best five count), Иван two big ones.
  for (let d = 0; d < 7; d++) daily(mariya, shiftDay(lastMonday, d), 1000 + d * 100);
  daily(ivan, lastMonday, 3000);
  daily(ivan, shiftDay(lastMonday, 1), 2900);
  // This week (today): Иван only.
  daily(ivan, dayKey(now), 5000);

  run('DELETE FROM notifications');
  assert.equal(groups.settleGroupWeeks(now), 1);
  assert.equal(groups.settleGroupWeeks(now), 0, 'once');
  const won = one<{ winner_id: number; score: number }>(
    'SELECT winner_id, score FROM group_weeks WHERE group_id = ? AND week = ?',
    made.id,
    lastMonday,
  )!;
  assert.deepEqual([won.winner_id, won.score], [mariya, 1200 + 1300 + 1400 + 1500 + 1600]);
  const notes = all<{ user_id: number; text: string }>('SELECT user_id, text FROM notifications ORDER BY user_id');
  assert.deepEqual(
    notes.map((n) => n.user_id),
    [mariya, ivan],
    'whoever played that week',
  );
  assert.match(notes[1].text, /^Седмицата в „Офис 3“ свърши: 2-ро място\. Спечели Мария с 7000 т\.$/);

  const info = groups.groupInfo(made.id, petar, now)!;
  assert.deepEqual(
    info.week.entries.map((e) => [e.user.username, e.score, e.days, e.today, e.crown]),
    [['Иван', 5000, 1, 5000, false]],
  );
  assert.deepEqual(
    info.week.waiting.map((u) => u.username),
    ['Мария', 'Петър'],
  );
  assert.deepEqual(
    info.history.map((h) => [h.week, h.winner?.username, h.score]),
    [[lastMonday, 'Мария', 7000]],
  );
  assert.equal(groups.groupInfo(made.id, account(), now), null, 'members only');

  const [summary] = groups.myGroups(mariya, now);
  assert.deepEqual(
    { ...summary },
    {
      id: made.id,
      name: 'Офис 3',
      members: 3,
      you: null,
      leader: { username: 'Иван', score: 5000, you: false },
      crown: true,
    },
  );
});

test('a group made this week has no last week to settle', () => {
  const owner = account();
  const made = groups.createGroup(owner, 'Нова група');
  assert.ok(made.ok);
  const lastMonday = shiftDay(weekStart(dayKey()), -7);
  assert.equal(groups.settleWeek(made.id, lastMonday), false);
});

test('how the day went for everyone: shown once enough have played', () => {
  // A day nobody else in this file played.
  const day = shiftDay(dayKey(), -30);
  const at = dayEndsAt(day) - 60_000;
  const players = Array.from({ length: DAILY_FIELD.minPlayers }, () => account());
  const play = (userId: number, score: number, correct: number) => {
    run('INSERT INTO daily_results (user_id, day, started_at, own_set) VALUES (?, ?, ?, 0)', userId, day, at);
    return recordDailyResult(userId, day, score, correct, 30_000, true);
  };
  for (const [i, userId] of players.slice(0, -1).entries()) assert.equal(play(userId, i * 100, i % 11).field, null);
  // The twentieth, with the best score: better than all 19 others.
  const field = play(players.at(-1)!, 9000, 10).field!;
  assert.equal(field.beaten, 1);
  assert.equal(
    field.histogram.reduce((a, b) => a + b),
    DAILY_FIELD.minPlayers,
  );
  assert.equal(field.histogram[10], 2);
});
