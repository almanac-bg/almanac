import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  answerPoints,
  closeness,
  dayEndsAt,
  dayKey,
  eliminationSchedule,
  knockoutsAfter,
  levelFromXp,
  levelProgress,
  meetsRequirement,
  NUMBER,
  newlyUnlocked,
  numberPoints,
  READING,
  rankFor,
  readingMs,
  seasonEndsAt,
  seasonName,
  seasonTitle,
  shiftDay,
  shiftSeason,
  snapNumber,
  sofiaMidnight,
  sofiaTimeOn,
  teamPoints,
  xpToReach,
} from '@quiz/shared';
import { writeFixtureQuestions } from './helpers';

// Server modules open the database on import — point them at a throwaway one first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-rules-'));
process.env.DB_PATH = path.join(tmp, 'rules.db');
process.env.QUESTIONS_PATH = path.join(tmp, 'questions.json');
writeFixtureQuestions(process.env.QUESTIONS_PATH);
const { pickQuestions, seededRng } = await import('../src/questions');
const { ordinal } = await import('@quiz/shared');
const { nameProblem } = await import('../src/moderation');
const { textProblem } = await import('../src/names');
const { nameShape } = await import('../src/names');

test('elimination schedule leaves a two-player final', () => {
  assert.deepEqual(
    eliminationSchedule(4, 10),
    [4, 8],
    'the first after question 4: one unlucky opener sends nobody home',
  );
  assert.deepEqual(eliminationSchedule(8, 15), [4, 6, 8, 9, 11, 13], 'Роял: the final two play the last two');
  assert.deepEqual(eliminationSchedule(8, 10), [3, 4, 5, 6, 7, 8], 'from 3 when a short match has no room otherwise');
  assert.deepEqual(eliminationSchedule(2, 10), []);
  assert.deepEqual(eliminationSchedule(8, 5), [3], 'caps eliminations when there are too few questions');
});

test('scoring: the speed bonus drains only after the reading window, which grows with the question and its options', () => {
  assert.equal(readingMs(''), READING.minMs);
  assert.equal(readingMs('x'.repeat(500)), READING.maxMs);
  assert.equal(READING.maxMs, 4_500);
  assert.ok(readingMs('x'.repeat(90)) > readingMs('x'.repeat(40)));
  assert.equal(readingMs('x'.repeat(40), ['ab', 'cd', 'ef', 'gh']), readingMs('x'.repeat(48)), 'the options count');
  const at = (timeMs: number) =>
    answerPoints({ timeMs, limitMs: 15_000, readMs: 2_000, streak: 1, doubled: false, retried: false });
  assert.equal(at(300), 1000, 'tapped before reading: nothing gained…');
  assert.equal(at(2_000), 1000, '…over reading it first');
  assert.equal(at(8_500), 750, 'halfway through the rest of the clock: half the speed bonus');
  assert.equal(at(15_000), 500);
});

test('a number scores by how close it is: nothing a tolerance off (on a log scale, a tolerance-fold), 250 more if exact', () => {
  const year = { answer: 1878, scale: 'linear', tolerance: 30, step: 1, min: 1000, max: 2025 } as const;
  assert.equal(numberPoints(1878, year), 1250);
  assert.equal(numberPoints(snapNumber(1878.4, year), year), 1250, 'a guess is taken in whole steps');
  assert.equal(numberPoints(1893, year), 500, 'half the tolerance off: half the points');
  assert.equal(numberPoints(1908, year), 0);
  assert.equal(numberPoints(1700, year), 0, 'never below nothing');
  assert.ok(
    closeness(1872, year) >= NUMBER.rightFrom && closeness(1871, year) < NUMBER.rightFrom,
    'close enough is right',
  );
  const size = { answer: 5000, scale: 'log', tolerance: 3, step: 1 } as const;
  assert.equal(closeness(15_000, size), 0, 'three times too big');
  assert.equal(closeness(5000 / 3, size), 0, 'or too small');
  assert.equal(numberPoints(10_000, size), numberPoints(2500, size), 'twice as big is as far off as half');
  assert.equal(snapNumber(1877.6, year), 1878);
  assert.equal(snapNumber(3000, year), 2025, 'kept in its range');
  assert.equal(snapNumber(0.30000000000000004, { min: 0, max: 1, step: 0.1 }), 0.3);
});

test('level curve', () => {
  assert.equal(xpToReach(1), 0);
  assert.equal(xpToReach(2), 100);
  assert.equal(xpToReach(10), 4500);
  assert.equal(levelFromXp(99), 1);
  assert.equal(levelFromXp(100), 2);
  assert.deepEqual(levelProgress(150), { level: 2, into: 50, needed: 200, pct: 0.25 });
});

test('rank tiers', () => {
  assert.equal(rankFor(900).id, 'bronze');
  assert.equal(rankFor(1100).id, 'silver');
  assert.equal(rankFor(1250).id, 'gold');
  assert.equal(rankFor(1700).id, 'master');
});

test('days and seasons follow Sofia time, across DST changes', () => {
  // Summer time (UTC+3) until 25 Oct 2026.
  assert.equal(dayKey(Date.UTC(2026, 9, 18, 20, 59)), '2026-10-18');
  assert.equal(dayKey(Date.UTC(2026, 9, 18, 21, 0)), '2026-10-19');
  assert.equal(sofiaMidnight(2026, 10, 19), Date.UTC(2026, 9, 18, 21, 0));
  assert.equal(dayEndsAt('2026-10-18'), Date.UTC(2026, 9, 18, 21, 0));
  // Winter time (UTC+2) after the switch.
  assert.equal(sofiaMidnight(2026, 10, 26), Date.UTC(2026, 9, 25, 22, 0));
  assert.equal(
    sofiaMidnight(2026, 3, 29),
    Date.UTC(2026, 2, 28, 22, 0),
    'midnight before the spring switch is still UTC+2',
  );
  assert.equal(seasonEndsAt('2026-12'), Date.UTC(2026, 11, 31, 22, 0));
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftSeason('2026-12', 1), '2027-01');
  assert.equal(seasonName('2026-10'), 'октомври 2026');
  assert.equal(seasonTitle('2026-10'), 'Октомври 2026');
});

test('unlock requirements', () => {
  const ctx = {
    level: 10,
    achievements: new Set(['royale_win']),
    seasonTier: 2,
    mastery: { history: 1 },
    eveningChampion: false,
  };
  assert.ok(meetsRequirement({ level: 10 }, ctx));
  assert.ok(!meetsRequirement({ level: 11 }, ctx));
  assert.ok(meetsRequirement({ achievement: 'royale_win' }, ctx));
  assert.ok(meetsRequirement({ season: 'gold' }, ctx));
  assert.ok(!meetsRequirement({ season: 'platinum' }, ctx));
  // A mastery tier earned covers the ones below it, in its own category only.
  assert.ok(meetsRequirement({ mastery: { category: 'history', tier: 0 } }, ctx));
  assert.ok(meetsRequirement({ mastery: { category: 'history', tier: 1 } }, ctx));
  assert.ok(!meetsRequirement({ mastery: { category: 'history', tier: 2 } }, ctx));
  assert.ok(!meetsRequirement({ mastery: { category: 'music', tier: 0 } }, ctx));
  const gained = newlyUnlocked(
    { level: 2, achievements: new Set(), seasonTier: -1, mastery: {}, eveningChampion: false },
    { level: 3, achievements: new Set(), seasonTier: 1, mastery: { sports: 0 }, eveningChampion: true },
  );
  assert.ok(
    gained.some((u) => u.kind === 'avatar' && u.id === 'tiger'),
    'the tiger at level 3',
  );
  assert.ok(
    gained.some((u) => u.kind === 'frame' && u.id === 'season_silver'),
    'silver season frame',
  );
  assert.ok(
    gained.some((u) => u.kind === 'title' && u.id === 'sports_knower'),
    '„Познавач · Спорт“',
  );
});

test('the evening Роял: the bottom 20% go out after the 4th, 30% at the later cuts, all but two after the 13th', () => {
  const left: number[] = [];
  let active = 50;
  for (let n = 1; n <= 13; n++) {
    const out = knockoutsAfter('evening', [], n, active);
    if (n < 4) assert.equal(out, 0, 'nobody out in the first three');
    active -= out;
    if ([4, 7, 10, 12, 13].includes(n)) left.push(active);
  }
  assert.deepEqual(left, [40, 28, 20, 14, 2]);
  // A small evening (the bots make it 8) still ends on two, one at a time where a share is less than one.
  const small: number[] = [];
  active = 8;
  for (const n of [4, 7, 10, 12, 13]) {
    active -= knockoutsAfter('evening', [], n, active);
    small.push(active);
  }
  assert.deepEqual(small, [6, 4, 3, 2, 2]);
  assert.equal(knockoutsAfter('royale', [4, 6], 4, 8), 1);
  assert.equal(knockoutsAfter('royale', [4, 6], 5, 8), 0);
  assert.equal(knockoutsAfter('royale', [4, 6], 6, 2), 0, 'never below two');
});

test('teams of equal size add their points up; unequal ones count the smaller side as if it were as large', () => {
  assert.deepEqual(
    teamPoints([
      [0, 1000],
      [0, 500],
      [1, 800],
      [1, 800],
    ]),
    [1500, 1600],
  );
  // Three against two: 3 × 900 = 2700 against 2 × 1200 = 2400 summed, but 1200 a head beats 900.
  assert.deepEqual(
    teamPoints([
      [0, 900],
      [0, 900],
      [0, 900],
      [1, 1200],
      [1, 1200],
    ]),
    [2700, 3600],
  );
  assert.deepEqual(teamPoints([[1, 700]]), [0, 700], 'an empty side scores nothing');
});

test('21:00 in Sofia is the same wall-clock time across the clock changes', () => {
  // Summer time (UTC+3) starts 2026-03-29 and ends 2026-10-25.
  assert.equal(new Date(sofiaTimeOn('2026-03-28', 21)).toISOString(), '2026-03-28T19:00:00.000Z');
  assert.equal(new Date(sofiaTimeOn('2026-03-29', 21)).toISOString(), '2026-03-29T18:00:00.000Z');
  assert.equal(new Date(sofiaTimeOn('2026-10-25', 21)).toISOString(), '2026-10-25T19:00:00.000Z');
  assert.equal(new Date(sofiaTimeOn('2026-10-24', 21, 30, 15)).toISOString(), '2026-10-24T18:30:15.000Z');
});

test('question picking: a ramp with blurred seams, category cap and seeded determinism', () => {
  const picked = pickQuestions(10, 'mixed', new Map());
  assert.equal(picked.length, 10);
  const level: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
  const matches = Array.from({ length: 300 }, () =>
    pickQuestions(10, 'mixed', new Map()).map((q) => level[q.difficulty]),
  );
  for (const m of matches) {
    const firstHard = m.indexOf(2);
    assert.ok(firstHard === -1 || !m.slice(firstHard).includes(0), `an easy one after a hard one: ${m.join('')}`);
  }
  const mean = (from: number, to: number) =>
    matches.reduce((sum, m) => sum + m.slice(from, to).reduce((a, b) => a + b, 0), 0) / (matches.length * (to - from));
  assert.ok(mean(0, 3) < mean(3, 7) && mean(3, 7) < mean(7, 10), 'still easier at the start, harder at the end');
  assert.ok(matches.filter((m) => m[0] === 0).length > 0.9 * matches.length, 'it nearly always opens with an easy one');
  const firstMedium = new Set(matches.map((m) => m.indexOf(1)));
  assert.ok(firstMedium.size >= 3, 'the first medium question moves around');
  const perCategory = new Map<string, number>();
  for (const q of picked) perCategory.set(q.category, (perCategory.get(q.category) ?? 0) + 1);
  assert.ok(Math.max(...perCategory.values()) <= 3, 'no category dominates a mixed match');
  for (const q of picked) assert.ok(q.options[q.answer].includes('✓'), 'answer index follows the shuffle');

  const a = pickQuestions(10, 'mixed', new Map(), seededRng('daily:2026-10-18'));
  const b = pickQuestions(10, 'mixed', new Map(), seededRng('daily:2026-10-18'));
  const c = pickQuestions(10, 'mixed', new Map(), seededRng('daily:2026-10-19'));
  assert.deepEqual(a, b, 'same seed → same questions and option order');
  assert.notDeepEqual(a, c, 'another day → another set');
});

test('question picking: unseen first, then what the players saw longest ago', () => {
  const every = pickQuestions(30, 'history', new Map());
  assert.equal(every.length, 30);
  const stale = new Set(pickQuestions(10, 'history', new Map()).map((q) => q.id));
  const seen = new Map(every.map((q) => [q.id, stale.has(q.id) ? 1 : 2]));
  assert.deepEqual(
    new Set(pickQuestions(10, 'history', seen).map((q) => q.id)),
    stale,
    'the longest-ago ones come back first',
  );
  const fresh = every.find((q) => q.difficulty === 'easy' && !stale.has(q.id))!;
  seen.delete(fresh.id);
  assert.ok(
    pickQuestions(10, 'history', seen).some((q) => q.id === fresh.id),
    'a question nobody saw beats them all',
  );
});

test('Bulgarian ordinals', () => {
  assert.deepEqual([1, 2, 3, 4, 7, 8, 11, 12, 21].map(ordinal), [
    '1-во',
    '2-ро',
    '3-то',
    '4-то',
    '7-мо',
    '8-мо',
    '11-то',
    '12-то',
    '21-во',
  ]);
});

test('username filter: catches disguised words, spares ordinary names', () => {
  for (const bad of [
    'Fuck',
    'f.u.c.k',
    'ПУТКА',
    'pu7ka',
    'КуРвА',
    'хуй123',
    'Хуйло',
    'sh1t_head',
    'Пичкаджия',
    'admin',
    'Админ',
    'Модератор_1',
    'almanac',
    'АЛМАНАХ',
  ]) {
    assert.ok(nameProblem(bad), `should block "${bad}"`);
  }
  for (const ok of [
    'Себастиан',
    'Badminton',
    'Маркетинг',
    'Иван',
    'Курт',
    'Торпедо',
    'Лебед',
    'Мария_92',
    'Kurtis',
    'Huxley',
    'Ребека',
    'Supper',
  ]) {
    assert.equal(nameProblem(ok), null, `should allow "${ok}"`);
  }
});

test('more words nobody should see (from the October 2026 review); group, set and room names get the same check', () => {
  for (const bad of [
    'Мангал_бой',
    'Жидов',
    'Негър',
    'Сиптар',
    'Лайнар',
    'Гъзолизец',
    'Духач',
    'Kurec',
    'SiegHeil',
    'Heil88',
    'Porno',
  ])
    assert.ok(nameProblem(bad), `should block "${bad}"`);
  for (const bad of [
    'Хитлер фен клуб',
    'Kurvi i pedali',
    'АЛМАНАХ Официален',
    'Модератори',
    'Хитлер беше прав',
    'п1чка ти',
    'Админ екип',
  ])
    assert.ok(textProblem(bad, 'Името'), `should block "${bad}"`);
  for (const ok of [
    'Слънчева система',
    'Клас 7Б',
    'Семейство Иванови',
    'Почитатели на историята',
    'Badminton клуб',
    'Ребека',
  ])
    assert.equal(textProblem(ok, 'Името'), null, `should allow "${ok}"`);
  assert.equal(
    textProblem('Модератори', 'Името на групата'),
    'Името на групата изглежда като на самата игра или на екипа ѝ — избери друго.',
  );
});

test('names that look the same on screen have one shape; names that only share letters do not', () => {
  const same = (a: string, b: string) => nameShape(a) === nameShape(b);
  assert.ok(same('Hristo', '\u041dristo'), 'a Cyrillic Н for a Latin H');
  assert.ok(same('maria', 'm\u0430ri\u0430'), 'Cyrillic а');
  assert.ok(same('Pop', '\u03a1op'), 'a Greek Ρ');
  assert.ok(same('lena', 'Iena'), 'a capital I is a lowercase l in a sans-serif font');
  assert.ok(same('Zoë', 'Zoe\u0308'), 'an accent typed either way');
  assert.ok(!same('Lena', 'Iena'), 'case stays: L and I look nothing alike');
  assert.ok(!same('Иван', 'Ivan'), 'transliteration is a different name, not a disguise');
  assert.ok(!same('maria', 'maria_'), 'every visible character counts');
});
