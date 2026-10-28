// Limits against floods: the rate limiter (which a flood must never be able to empty) and how many password hashes run
// at once (they share libuv's threads with serving files, and the CPU with the game).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// Server modules open the database on import — point them at a throwaway one first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-limits-'));
process.env.DB_PATH = path.join(tmp, 'limits.db');
const { network, RateLimiter, wideNetwork } = await import('../src/throttle');
const { hashingLimits } = await import('../src/auth');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const MIN = 60_000;
const NOW = 1_000_000;

test('a flood of new keys never lifts a limit that has been hit', () => {
  const limiter = new RateLimiter(100);
  const guess = (account: string) => limiter.hit(`login-account:${account}`, 30, 15 * MIN, NOW);
  for (let i = 0; i < 30; i++) assert.equal(guess('victim'), false);
  assert.equal(guess('victim'), true);
  // A new username every time, each a new key: the old limiter forgot every counter once it held too many.
  for (let i = 0; i < 10_000; i++) guess(`random${i}`);
  assert.equal(guess('victim'), true, 'still over its limit');
  assert.ok(limiter.keys('login-account') <= 100, 'and the scope stays within its size');
});

test("a flood in one scope leaves every other scope's counters alone", () => {
  const limiter = new RateLimiter(100);
  for (let i = 0; i < 3; i++) assert.equal(limiter.hit('guest-all', 3, 60 * MIN, NOW), false);
  // One IPv6 /48 is 65,536 networks, each a key of its own.
  for (let i = 0; i < 10_000; i++) limiter.hit(`guest:2001:db8:0:${i.toString(16)}::/64`, 300, 60 * MIN, NOW);
  assert.equal(limiter.hit('guest-all', 3, 60 * MIN, NOW), true, 'the count for everyone went on where it was');
  assert.equal(limiter.keys('guest-all'), 1);
});

test('a scope full of limits that have been hit turns a new key away rather than forget one', () => {
  const limiter = new RateLimiter(5);
  const join = (userId: string, now = NOW) => limiter.hit(`room-join:${userId}`, 1, 10 * MIN, now);
  for (let i = 0; i < 5; i++) {
    join(`u${i}`);
    assert.equal(join(`u${i}`), true);
  }
  assert.equal(join('newcomer'), true, 'no room: counted as over its limit');
  for (let i = 0; i < 5; i++) assert.equal(join(`u${i}`), true, 'every limit still holds');
  assert.equal(join('newcomer', NOW + 10 * MIN + 1), false, 'once the windows end, there is room again');
});

test('keys under their limit make room oldest first; an ended window starts over', () => {
  const limiter = new RateLimiter(3);
  const ask = (login: string, now = NOW) => limiter.hit(`forgot:${login}`, 2, 60 * MIN, now);
  ask('a');
  ask('b');
  ask('c');
  ask('d'); // "a" was the oldest
  assert.equal(limiter.keys('forgot'), 3);
  assert.equal(ask('d'), false);
  assert.equal(ask('d'), true);
  assert.equal(ask('d', NOW + 60 * MIN + 1), false, 'a new window');

  limiter.sweep(NOW + 60 * MIN + 1);
  assert.equal(limiter.keys('forgot'), 1, 'sweeping forgets the windows that ended');
});

test('addresses are counted by their network, and by the wider network around it', () => {
  assert.equal(network('203.0.113.7'), '203.0.113.7');
  assert.equal(network('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(network('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(wideNetwork('203.0.113.7'), '203.0.113.0/24');
  assert.equal(wideNetwork('::ffff:203.0.113.200'), '203.0.113.0/24');
  assert.equal(wideNetwork('2001:db8:1:2:3:4:5:6'), '2001:db8:1::/48');
  assert.equal(wideNetwork('2001:db8::1'), '2001:db8:0::/48');
  assert.equal(wideNetwork(undefined), 'unknown');
});

test('password hashing leaves two pool threads and a CPU core free, and queues about three seconds', () => {
  assert.deepEqual(hashingLimits(4, 8), { slots: 2, waiting: 32 }, "libuv's default pool");
  assert.deepEqual(hashingLimits(8, 8), { slots: 4, waiting: 64 }, 'the Docker image (UV_THREADPOOL_SIZE=8)');
  assert.deepEqual(hashingLimits(8, 2), { slots: 1, waiting: 16 }, 'a two-core server keeps a core for the game');
  assert.deepEqual(hashingLimits(1, 1), { slots: 1, waiting: 16 }, 'always at least one');
  assert.deepEqual(hashingLimits(64, 64), { slots: 4, waiting: 64 }, 'never more than four (64 MiB each)');
});
