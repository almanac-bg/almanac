// Another process writing to the database while the server runs: Litestream (its checkpoints and bookkeeping), or the
// admin command line. The server waits a moment for it rather than failing; held longer (past busy_timeout), writes
// fail at once until it lets go (db.ts's breaker), plainly, and nothing of a match is lost.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { autoPlay, connect, connected, emitAck, next, register, sleep, startServer } from './helpers';

const T = { timeout: 60_000 };

test(
  'a second writer holding the database: the server waits it out, and past its patience one request fails',
  T,
  async () => {
    const srv = await startServer();
    // The refused sign-up below is reported as an error, as it should be in production.
    srv.allowErrors(/the database stayed locked/);
    const other = new DatabaseSync(srv.dbPath);
    try {
      // A moment's hold, as Litestream's checkpoint takes: waited out.
      other.exec('BEGIN IMMEDIATE');
      const signup = register(srv.url, 'izchaka_zapisa');
      await sleep(300);
      other.exec('COMMIT');
      assert.ok((await signup).user.id, 'it waited for the other writer, then wrote');

      // Held past the server's patience (busy_timeout, 1 s): that request is refused as a busy moment, nothing worse.
      other.exec('BEGIN IMMEDIATE');
      const refused = await fetch(`${srv.url}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'ne_dochaka', password: 'secret123' }),
      });
      other.exec('COMMIT');
      assert.equal(refused.status, 503);
      assert.match(((await refused.json()) as { error: string }).error, /натоварен/);

      // The breaker's probe sees the lock gone within a quarter of a second.
      await sleep(400);
      assert.ok((await register(srv.url, 'sledvashtiyat')).user.id, 'the server is fine, and the next one works');
      // The uptime check hears of it for a minute: a read alone stayed green through a 16-second lock.
      const health = await fetch(`${srv.url}/api/health`);
      assert.equal(health.status, 503);
      assert.deepEqual(await health.json(), { ok: false, problem: 'locked' });
    } finally {
      other.close();
      await srv.stop();
    }
  },
);

test(
  'held long, a lock costs one wait, not one per write: a match keeps its pace, and its result is saved when it lets go',
  T,
  async () => {
    const srv = await startServer();
    srv.allowErrors(/the database stayed locked|match results/);
    const A = await register(srv.url, 'drugiyat_pishe');
    const sa = connect(srv.url, A.cookie);
    await connected(sa);
    const other = new DatabaseSync(srv.dbPath);
    try {
      const reveals: number[] = [];
      sa.on('game:reveal', () => reveals.push(Date.now()));
      const play = autoPlay(sa, 'right');
      assert.ok((await emitAck(sa, 'solo:start', { category: 'mixed' })).ok);
      await sleep(300);
      other.exec('BEGIN IMMEDIATE');
      const lockedAt = Date.now();
      // Three writes while it's held: the first waits its second, the others fail at once (they each slept the whole
      // server for 5 s before: the 31 October review, SERVER-1).
      const statuses = await Promise.all(
        ['pishe_1', 'pishe_2', 'pishe_3'].map((username) =>
          fetch(`${srv.url}/api/auth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username, password: 'secret123' }),
          }).then((r) => r.status),
        ),
      );
      const refusedIn = Date.now() - lockedAt;
      assert.deepEqual(statuses, [503, 503, 503]);
      assert.ok(refusedIn < 2_500, `all three refused within ${refusedIn} ms`);
      // The match ends while it's held: how it ended at once, its rewards still being saved.
      const { end } = await play;
      assert.deepEqual([end.saving, end.rewards], [true, null]);
      const gaps = reveals.slice(1).map((t, i) => t - reveals[i]);
      assert.ok(Math.max(...gaps) < 2_000, `the match kept its pace: reveals ${gaps.join(', ')} ms apart`);
      // Let go: the retry gets through, and the rewards follow.
      const late = next(sa, 'game:rewards');
      other.exec('COMMIT');
      const { gameId, rewards } = await late;
      assert.equal(gameId, end.gameId);
      assert.ok(rewards && rewards.xpGained > 0, 'saved, nothing lost');
    } finally {
      other.close();
      sa.close();
      await srv.stop();
    }
  },
);
