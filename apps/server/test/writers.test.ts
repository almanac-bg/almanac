// Another process writing to the database while the server runs: Litestream (its checkpoints and bookkeeping), or the
// admin command line. The server waits for it rather than failing; if it can't wait any longer (busy_timeout), only that
// one request fails, plainly, and the next one works.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { register, sleep, startServer } from './helpers';

const T = { timeout: 60_000 };

test(
  'a second writer holding the database: the server waits it out, and past its patience one request fails',
  T,
  async () => {
    const srv = await startServer();
    const other = new DatabaseSync(srv.dbPath);
    try {
      other.exec('BEGIN IMMEDIATE');
      const signup = register(srv.url, 'izchaka_zapisa');
      await sleep(1_000);
      other.exec('COMMIT');
      assert.ok((await signup).user.id, 'it waited for the other writer, then wrote');

      // Held past the server's patience (busy_timeout, 5 s): that request is refused as a busy moment, nothing worse.
      other.exec('BEGIN IMMEDIATE');
      const refused = await fetch(`${srv.url}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'ne_dochaka', password: 'secret123' }),
      });
      other.exec('COMMIT');
      assert.equal(refused.status, 503);
      assert.match(((await refused.json()) as { error: string }).error, /натоварен/);

      assert.ok((await register(srv.url, 'sledvashtiyat')).user.id, 'the server is fine, and the next one works');
      assert.ok((await fetch(`${srv.url}/api/health`)).ok);
    } finally {
      other.close();
      await srv.stop();
    }
  },
);
