// The server as it runs in production (NODE_ENV=production): admins, browser hardening, health.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { register, startServer, type TestServer } from './helpers';

let srv: TestServer;

before(async () => {
  srv = await startServer({ NODE_ENV: 'production', ADMIN_USERNAMES: 'Собственик' });
});

after(async () => {
  await srv?.stop();
});

test('signing up first does not make you an admin; ADMIN_USERNAMES does', async () => {
  const stranger = await register(srv.url, 'pyrvi_stranger');
  assert.equal(stranger.user.isAdmin, false);
  const owner = await register(srv.url, 'собственик');
  assert.equal(owner.user.isAdmin, true, 'listed usernames match case-insensitively');
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
