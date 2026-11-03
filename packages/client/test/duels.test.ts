// A friend duel's words, the same on the web and in the app: the time left, whose turn, how it ended, the order.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DuelEntry, DuelStanding, PublicUser } from '@almanac/shared';
import { duelLine, duelStatus, sortDuels, timeLeft } from '../src/index.ts';

const HOUR = 3_600_000;
const now = 1_000 * HOUR;
const friend = { id: 9, username: 'Мария' } as PublicUser;
const standing = (more: Partial<DuelStanding> = {}): DuelStanding => ({
  friend,
  mine: null,
  theirs: null,
  outcome: null,
  record: { wins: 0, losses: 0, draws: 0 },
  expiresAt: now + 5 * HOUR,
  expired: false,
  canPick: false,
  ...more,
});
const entry = (
  id: string,
  state: DuelEntry['state'],
  createdAt: number,
  more: Partial<DuelStanding> = {},
): DuelEntry => ({
  ...standing(more),
  id,
  state,
  createdAt,
});

test('the time left: hours, then minutes, never 0', () => {
  assert.equal(timeLeft(now + 21 * HOUR + 59 * 60_000, now), 'остават 21 ч.');
  assert.equal(timeLeft(now + HOUR, now), 'остава 1 ч.');
  assert.equal(timeLeft(now + 90_000, now), 'остават 2 мин.');
  assert.equal(timeLeft(now + 1_000, now), 'остава 1 мин.');
  assert.equal(timeLeft(now, now), 'времето изтече');
});

test('a duel head to head: whose turn, the wait, the end', () => {
  assert.equal(duelStatus(standing(), now), 'Твой ред · остават 5 ч.');
  const played = { score: 900, correct: 6, timeMs: 1 };
  assert.equal(duelStatus(standing({ mine: played }), now), 'Чакаме Мария · остават 5 ч.');
  assert.equal(duelStatus(standing({ mine: played, expired: true }), now), 'Мария не го изигра навреме');
  assert.equal(duelStatus(standing({ outcome: 'draw' }), now), 'Равенство');
});

test('a duel in a list, and the list in order: yours, theirs, results, newest first', () => {
  const theirs = { score: 1200, correct: 7, timeMs: 1 };
  assert.equal(duelLine(entry('a', 'yours', 0, { theirs }), now), '1200 т. за биене · остават 5 ч.');
  assert.equal(duelLine(entry('b', 'yours', 0), now), 'Ти започваш · остават 5 ч.');
  const done = entry('c', 'done', 0, { mine: { score: 15_000, correct: 9, timeMs: 1 }, theirs, outcome: 'won' });
  assert.equal(duelLine(done, now), 'Победа · 15 000 : 1200');
  const list = [
    entry('old', 'done', 1),
    entry('mine', 'yours', 2),
    entry('new', 'done', 3),
    entry('wait', 'theirs', 4),
  ];
  assert.deepEqual(
    sortDuels(list).map((d) => d.id),
    ['mine', 'wait', 'new', 'old'],
  );
});
