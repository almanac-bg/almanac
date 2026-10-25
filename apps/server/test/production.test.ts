// The server as it runs in production (NODE_ENV=production): admins, browser hardening, health.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { cli, connect, connected, emitAck, http, next, register, startServer, type TestServer } from './helpers';

let srv: TestServer;
// Error reporting on, pointed at a port nothing listens on (reports are dropped quietly).
const DSN = 'http://public@127.0.0.1:9/1';

before(async () => {
  // PUBLIC_QUEUES as it ships (unset): only some ranked queues are open.
  srv = await startServer({ NODE_ENV: 'production', PUBLIC_QUEUES: '', SENTRY_DSN: DSN });
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

test('at launch only Duel and Royale are open, and the lobby says so', async () => {
  const player = await register(srv.url, 'opashka_test');
  const socket = connect(srv.url, player.cookie);
  const stats = next<{ modes: string[] }>(socket, 'lobby:stats');
  await connected(socket);
  assert.deepEqual((await stats).modes, ['duel', 'royale']);
  const closed = await emitAck(socket, 'queue:join', 'trio');
  assert.equal(closed.ok, false);
  assert.match(closed.error, /Дуел или Роял/);
  assert.ok((await emitAck(socket, 'queue:join', 'duel')).ok);
  socket.emit('queue:leave');
  socket.close();
});

test('with error reporting on, the page carries the DSN and the tunnel only takes our own project', async () => {
  const envelope = (dsn: string) => `${JSON.stringify({ dsn })}\n{"type":"event"}\n{}\n`;
  const post = (body: string) => fetch(`${srv.url}/api/monitoring`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body });
  assert.equal((await post(envelope(DSN))).status, 200);
  assert.equal((await post(envelope('https://other@evil.example/1'))).status, 400, 'not an open relay');
  if (fs.existsSync(path.resolve(import.meta.dirname, '../../web/dist/index.html'))) {
    const page = await (await fetch(`${srv.url}/`)).text();
    assert.ok(page.includes(`<meta name="sentry-dsn" content="${DSN}" />`));
  }
});
