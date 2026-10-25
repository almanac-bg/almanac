// The server as it runs in production (NODE_ENV=production): admins, browser hardening, health, what it refuses.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { OperatorInfo } from '@quiz/shared';
import { cli, connect, connected, emitAck, http, next, register, startServer, type TestServer } from './helpers';

let srv: TestServer;
// Error reporting on, pointed at a port nothing listens on (reports are dropped quietly).
const DSN = 'http://public@127.0.0.1:9/1';

before(async () => {
  // PUBLIC_QUEUES as it ships (unset): only some ranked queues are open.
  srv = await startServer({
    NODE_ENV: 'production',
    PUBLIC_QUEUES: '',
    SENTRY_DSN: DSN,
    OPERATOR_NAME: 'Тест Тестов',
    OPERATOR_ADDRESS: 'ул. Примерна 1, София',
    SOURCE_URL: 'https://example.test/almanac',
    BACKUP_PROVIDER: 'Примерни бекъпи',
  });
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

test('a double-tapped sign-up makes one account and a clear "taken", never a server error', async () => {
  const signUp = () =>
    fetch(`${srv.url}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'dvoen_klik', password: 'secret123' }),
    });
  const responses = await Promise.all([signUp(), signUp(), signUp()]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409, 409]);
  const taken = (await responses.find((r) => r.status === 409)!.json()) as { error: string };
  assert.equal(taken.error, 'Това име вече е заето.');
});

test('a link cut short by a mail app gets a Bulgarian answer, not a validator message', async () => {
  const post = async (route: string, body: unknown) => {
    const res = await fetch(`${srv.url}/api${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return [res.status, ((await res.json()) as { error: string }).error] as const;
  };
  for (const route of ['/auth/verify-email', '/auth/reset']) {
    const [status, error] = await post(route, { token: 'abc', password: 'secret123' });
    assert.equal(status, 400);
    assert.match(error, /^Линкът е непълен/);
  }
  assert.deepEqual(await post('/auth/verify-email', { token: 42 }), [400, 'Невалидни данни.']);
});

test('production refuses to start without who runs the site (the legal pages need it)', async () => {
  await assert.rejects(
    startServer({ NODE_ENV: 'production', OPERATOR_NAME: '', OPERATOR_ADDRESS: '' }),
    /Set OPERATOR_NAME/,
  );
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
  const stats = next(socket, 'lobby:stats');
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
  const post = (body: string) =>
    fetch(`${srv.url}/api/monitoring`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body });
  assert.equal((await post(envelope(DSN))).status, 200);
  assert.equal((await post(envelope('https://other@evil.example/1'))).status, 400, 'not an open relay');
  if (fs.existsSync(path.resolve(import.meta.dirname, '../../web/dist/index.html'))) {
    const page = await (await fetch(`${srv.url}/`)).text();
    assert.ok(page.includes(`<meta name="sentry-dsn" content="${DSN}" />`));
  }
});

test('the lobby names the web build the server hosts, so tabs of an older one can reload', async () => {
  const built = fs.existsSync(path.resolve(import.meta.dirname, '../../web/dist/index.html'));
  const player = await register(srv.url, 'build_test');
  const socket = connect(srv.url, player.cookie);
  const stats = next(socket, 'lobby:stats');
  await connected(socket);
  const { build } = await stats;
  socket.close();
  if (!built) return assert.equal(build, null);
  const page = await (await fetch(`${srv.url}/`)).text();
  assert.ok(build && page.includes(`<meta name="app-build" content="${build}" />`), `build ${build}`);
});

test('who runs the site comes from the configuration, not the code (and the footer can link the source)', async () => {
  const legal = (await (await fetch(`${srv.url}/api/legal`)).json()) as OperatorInfo;
  assert.equal(legal.name, 'Тест Тестов');
  assert.equal(legal.address, 'ул. Примерна 1, София');
  assert.equal(legal.email, 'privacy@almanac.bg', 'a default contact address');
  assert.equal(legal.sourceUrl, 'https://example.test/almanac');
  assert.equal(legal.backups, 'Примерни бекъпи');
  assert.equal(legal.inbox, null, 'unset: the policy leaves the line out');
});
