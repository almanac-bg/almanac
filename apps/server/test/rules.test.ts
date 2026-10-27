import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  dayEndsAt,
  dayKey,
  eliminationSchedule,
  levelFromXp,
  levelProgress,
  meetsRequirement,
  newlyUnlocked,
  rankFor,
  seasonEndsAt,
  seasonName,
  seasonTitle,
  shiftDay,
  shiftSeason,
  sofiaMidnight,
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
const { nameShape } = await import('../src/names');

test('elimination schedule leaves a two-player final', () => {
  assert.deepEqual(eliminationSchedule(8, 15), [3, 5, 7, 9, 11, 13]);
  assert.deepEqual(eliminationSchedule(4, 10), [3, 8]);
  assert.deepEqual(eliminationSchedule(2, 10), []);
  assert.deepEqual(eliminationSchedule(8, 5), [3], 'caps eliminations when there are too few questions');
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
  const ctx = { level: 10, achievements: new Set(['royale_win']), seasonTier: 2 };
  assert.ok(meetsRequirement({ level: 10 }, ctx));
  assert.ok(!meetsRequirement({ level: 11 }, ctx));
  assert.ok(meetsRequirement({ achievement: 'royale_win' }, ctx));
  assert.ok(meetsRequirement({ season: 'gold' }, ctx));
  assert.ok(!meetsRequirement({ season: 'platinum' }, ctx));
  const gained = newlyUnlocked(
    { level: 2, achievements: new Set(), seasonTier: -1 },
    { level: 3, achievements: new Set(), seasonTier: 1 },
  );
  assert.ok(
    gained.some((u) => u.kind === 'avatar' && u.id === 'tiger'),
    'the tiger at level 3',
  );
  assert.ok(
    gained.some((u) => u.kind === 'frame' && u.id === 'season_silver'),
    'silver season frame',
  );
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
