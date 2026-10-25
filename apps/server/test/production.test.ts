// The server as it runs in production (NODE_ENV=production): admins, browser hardening, health.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cli, http, register, startServer, type TestServer } from './helpers';

let srv: TestServer;

before(async () => {
  srv = await startServer({ NODE_ENV: 'production' });
});

after(async () => {
  await srv?.stop();
});

test('nobody becomes an admin by signing up; the admin command line makes one', async () => {
  const first = await register(srv.url, 'pyrvi_stranger');
  assert.equal(first.user.isAdmin, false, 'not even the first account');
  const owner = await register(srv.url, 'Собственик');

  assert.equal(cli(srv.dbPath, 'admin', 'add', 'nobody_here').status, 1, 'unknown players are refused');
  const added = cli(srv.dbPath, 'admin', 'add', 'собственик');
  assert.equal(added.status, 0, added.output);
  const api = http(srv.url);
  assert.equal((await api.get('/api/me', owner.cookie)).body.user.isAdmin, true, 'names match case-insensitively');
  assert.match(cli(srv.dbPath, 'admin', 'list').output, /Собственик/);

  assert.equal(cli(srv.dbPath, 'admin', 'remove', 'Собственик').status, 0);
  assert.equal((await api.get('/api/me', owner.cookie)).body.user.isAdmin, false);
});

test('responses carry the browser hardening headers', async () => {
  const res = await fetch(`${srv.url}/api/health`);
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self' wss:\/\/almanac\.test/, 'the websocket origin follows APP_URL');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.ok(res.headers.get('referrer-policy'));
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('health answers from the database', async () => {
  const res = await fetch(`${srv.url}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('browser crash reports are accepted (and never echo anything back)', async () => {
  const res = await fetch(`${srv.url}/api/client-errors`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'render', message: 'Test crash', url: '/friends' }),
  });
  assert.equal(res.status, 204);
});
