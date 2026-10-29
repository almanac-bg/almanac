// Opponents any time: which recorded match a Дуел plays against (records.ts), what its owner hears, and friend duels'
// rules (challenges.ts).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { dayEndsAt, dayKey, shiftDay } from '@quiz/shared';
import { writeFixtureQuestions } from './helpers';

// Server modules open the database on import — point them at a throwaway one first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-opponents-'));
process.env.DB_PATH = path.join(tmp, 'opponents.db');
process.env.QUESTIONS_PATH = path.join(tmp, 'questions.json');
writeFixtureQuestions(process.env.QUESTIONS_PATH);
const { one, run } = await import('../src/db');
const { isChoice, markSeen, pickMatch, questionById, recentFor } = await import('../src/questions');
const { dailyQuestions } = await import('../src/daily');
const { noteRecordPlay, pickRecord, RECORDS, tellRecordOwners } = await import('../src/records');
const { claimChallengeAttempt, createDuel, DUEL, myDuels, recordChallengeResult, tellExpiredDuels } = await import(
  '../src/challenges'
);

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// 1: the player. 2: someone of about their skill. 3: much stronger. 4: a guest. 5: opted out. 6: banned. 7: a friend.
run(
  `INSERT INTO users (id, username, username_key, password_hash, created_at, is_guest, share_runs, banned_until, xp)
   VALUES (1, 'играч', 'играч', 'x', 0, 0, 1, NULL, 0), (2, 'равен', 'равен', 'x', 0, 0, 1, NULL, 0),
     (3, 'силен', 'силен', 'x', 0, 0, 1, NULL, 0), (4, 'гост', 'гост', 'x', 0, 1, 1, NULL, 0),
     (5, 'скрит', 'скрит', 'x', 0, 0, 0, NULL, 0), (6, 'спрян', 'спрян', 'x', 0, 0, 1, 9999999999999, 0),
     (7, 'приятел', 'приятел', 'x', 0, 0, 1, NULL, 0)`,
);
run(
  `INSERT INTO player_skill (user_id, category, rating, answers) VALUES (1, 'all', 1000, 100), (2, 'all', 1050, 100),
     (3, 'all', 1400, 100), (4, 'all', 1000, 100), (5, 'all', 1000, 100), (6, 'all', 1000, 100)`,
);

/** A Дуел's ten questions as a run keeps them: right on all but the second, no answer to the third. */
const ids = [
  'history-0',
  'history-1',
  'history-12',
  'music-2',
  'music-13',
  'music-14',
  'sports-15',
  'sports-24',
  'sports-25',
  'geography-n0',
];
function answers(changed = false) {
  return ids.map((q, i) => {
    const bank = questionById(q)!;
    if (!isChoice(bank)) return { q, i, c: null, g: 1810, ok: 1, t: 9000, p: 800, k: null };
    const right = changed ? (bank.answer + 1) % 4 : bank.answer;
    if (i === 2) return { q, i, c: null, ok: 0, t: null, p: 0, k: null };
    return { q, i, c: i === 1 ? (right + 1) % 4 : right, ok: i === 1 ? 0 : 1, t: 2000 + i * 100, p: 900, k: null };
  });
}
const addRun = (userId: number, opts: { mode?: string; changed?: boolean; at?: number } = {}) =>
  Number(
    run(
      `INSERT INTO runs (match_id, user_id, mode, category, rating, score, correct, answers, played_at)
       VALUES ('m', ?, ?, 'mixed', 1040, 7000, 8, ?, ?)`,
      userId,
      opts.mode ?? 'duel',
      JSON.stringify(answers(opts.changed)),
      opts.at ?? Date.now(),
    ).lastInsertRowid,
  );

test('a Дуел alone plays a recording of someone of about the same skill — no guest, no opted-out, no banned', () => {
  for (const owner of [1, 3, 4, 5, 6]) addRun(owner);
  assert.equal(pickRecord(1, 1000), null, 'only their own, or ones that do not fit');

  const runId = addRun(2);
  const pick = pickRecord(1, 1000)!;
  assert.equal(pick.runId, runId);
  assert.deepEqual([pick.player.name, pick.player.userId, pick.player.isBot], ['равен', null, false]);
  assert.equal(pick.player.rating, 1040, 'it shows the rating its owner had');
  assert.ok(pick.player.record);
  // Its answers, in this match's own option order.
  for (const [i, recorded] of pick.script.entries()) {
    const q = pick.questions[i];
    const bank = questionById(ids[i])!;
    if (!recorded) {
      assert.equal(i, 2);
      continue;
    }
    if (!isChoice(q) || !isChoice(bank)) {
      assert.equal(recorded.value, 1810);
      continue;
    }
    assert.equal(q.options[recorded.choice!], bank.options[answers()[i].c!]);
  }
  assert.deepEqual(
    pick.rounds.map((r) => r.category),
    ['history', 'music', 'sports'],
    'played in rounds: each as it was picked',
  );
});

test('not a recording with questions the player has seen, nor one whose questions changed since', () => {
  run('DELETE FROM runs');
  addRun(2, { changed: true });
  assert.equal(pickRecord(1, 1000), null, 'the pick no longer means what it meant');
  addRun(2);
  markSeen(1, ids.slice(0, RECORDS.maxSeen + 1));
  assert.equal(pickRecord(1, 1000), null, 'three questions known');
  run('DELETE FROM seen_questions');
  addRun(2, { at: Date.now() - (RECORDS.maxAgeDays + 1) * 24 * 60 * 60_000 });
  assert.ok(pickRecord(1, 1000), 'the fresh one');
  run('DELETE FROM runs');
  addRun(2, { at: Date.now() - (RECORDS.maxAgeDays + 1) * 24 * 60 * 60_000 });
  assert.equal(pickRecord(1, 1000), null, 'too old');
});

test("never today's daily, nor a link that may still be open: their questions are still to be played", () => {
  run('DELETE FROM runs');
  run('DELETE FROM seen_questions');
  const day = 24 * 60 * 60_000;
  addRun(2, { mode: 'daily' });
  addRun(2, { mode: 'challenge', at: Date.now() - 2 * day });
  assert.equal(pickRecord(1, 1000), null, "today's daily and a week-young link (or a friend duel) stay unplayed");
  // Yesterday's daily is over, and so is a link past its week.
  const yesterday = addRun(2, { mode: 'daily', at: dayEndsAt(shiftDay(dayKey(), -1)) - 60_000 });
  assert.equal(pickRecord(1, 1000)?.runId, yesterday);
  run('DELETE FROM runs WHERE id = ?', yesterday);
  const expired = addRun(2, { mode: 'challenge', at: Date.now() - 8 * day });
  assert.equal(pickRecord(1, 1000)?.runId, expired);
  run('DELETE FROM runs');
});

test("today's daily questions are kept out of every other match until midnight", () => {
  // Drawn by the first pick of the day, whoever's: a Соло at 00:01 can't take one of them first.
  const seen = recentFor([1]);
  const daily = dailyQuestions(dayKey(), 1).map((q) => q.id);
  assert.equal(daily.length, 10);
  for (const id of daily) assert.ok(seen.has(id), `${id} counts as seen`);
  // A whole morning of Соло Микс on the small test bank: none of the day's ten comes up.
  for (let i = 0; i < 30; i++)
    for (const q of pickMatch(10, 'mixed', recentFor([1]), { final: true }))
      assert.ok(!daily.includes(q.id), `${q.id} is one of today's`);
});

test("the next day, a recording's owner hears how it did, with XP for its wins (at most 50)", () => {
  run('DELETE FROM runs');
  const runId = addRun(2);
  const yesterday = shiftDay(dayKey(), -1);
  const at = dayEndsAt(yesterday) - 60 * 60_000;
  for (let i = 0; i < 7; i++) noteRecordPlay(runId, 2, 1, i < 6, at);
  const morning = dayEndsAt(yesterday) + 10 * 60 * 60_000;
  assert.equal(tellRecordOwners(dayEndsAt(yesterday) + 60 * 60_000), 0, 'not before 09:00');
  assert.equal(tellRecordOwners(morning), 1);
  assert.equal(one<{ xp: number }>('SELECT xp FROM users WHERE id = 2')!.xp, RECORDS.xpPerDay);
  const note = one<{ text: string }>('SELECT text FROM notifications WHERE user_id = 2')!;
  assert.equal(note.text, 'Записите на мачовете ти изиграха 7 дуела вчера: 6 победи, +50 XP.');
  assert.equal(tellRecordOwners(morning + 60 * 60_000), 0, 'once a day');
});

/** One of a duel's two plays it to the end with this score. */
const play = (id: string, userId: number, score: number) => {
  assert.ok(claimChallengeAttempt(id, userId).ok);
  return recordChallengeResult(id, userId, score, 5, 30_000);
};

test('a friend duel: only the two play it; the one behind picks the next one; a few open at a time', () => {
  const first = createDuel(1, 7);
  assert.ok(first.ok);
  assert.equal(claimChallengeAttempt(first.id, 2).ok, false, 'nobody else');
  play(first.id, 1, 6000);
  assert.equal(myDuels(7)[0].state, 'yours');
  const done = play(first.id, 7, 7000).duel!;
  assert.deepEqual([done.outcome, done.canPick], ['won', false]);
  assert.deepEqual(myDuels(1)[0].record, { wins: 0, losses: 1, draws: 0 });

  const picked = ['history', 'music', 'sports'] as const;
  assert.equal(createDuel(7, 1, [...picked]).ok, false, 'the winner draws');
  assert.ok(createDuel(1, 7, [...picked]).ok, 'the loser picks');
  assert.ok(createDuel(7, 1).ok);
  assert.ok(createDuel(1, 7).ok);
  assert.equal(createDuel(1, 7).ok, false, `${DUEL.openPerPair} open at a time`);
});

test('a duel that ran out unplayed: whoever played theirs hears so, once', () => {
  run('DELETE FROM challenges');
  const duel = createDuel(1, 7);
  assert.ok(duel.ok);
  play(duel.id, 1, 5000);
  const later = Date.now() + DUEL.hours * 60 * 60_000 + 1000;
  assert.equal(myDuels(1, later)[0].state, 'expired');
  run('DELETE FROM notifications');
  assert.equal(tellExpiredDuels(later), 1);
  assert.equal(
    one<{ text: string }>('SELECT text FROM notifications WHERE user_id = 1')!.text,
    'приятел не изигра дуела ви навреме.',
  );
  assert.equal(tellExpiredDuels(later + 1000), 0);
  assert.equal(claimChallengeAttempt(duel.id, 7).ok, true, 'still in time until then');
});
