// The server as it runs in production (NODE_ENV=production): admins, browser hardening, health, what it refuses.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { BRAND, type OperatorInfo, PUBLIC_PAGES, routeKind } from '@quiz/shared';
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

const built = fs.existsSync(path.resolve(import.meta.dirname, '../../web/dist/index.html'));

test('each public page has its own title and address; the game says noindex; a wrong address is a 404', {
  skip: !built,
}, async () => {
  const get = (route: string) => fetch(`${srv.url}${route}`, { redirect: 'manual' });
  const head = async (route: string) => {
    const res = await get(route);
    const html = await res.text();
    return {
      status: res.status,
      robotsHeader: res.headers.get('x-robots-tag'),
      title: /<title>([^<]*)<\/title>/.exec(html)?.[1],
      canonical: /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? null,
      robots: /<meta name="robots" content="([^"]*)"/.exec(html)?.[1],
    };
  };
  for (const [route, meta] of Object.entries(PUBLIC_PAGES)) {
    const page = await head(route);
    assert.equal(page.status, 200, route);
    assert.equal(page.title, meta.title, route);
    assert.equal(page.canonical, `https://almanac.test${route}`, route);
    assert.match(page.robots ?? '', /^index/, route);
    assert.equal(page.robotsHeader, null, route);
  }
  const settings = await head('/settings');
  assert.deepEqual(
    [settings.status, settings.robots, settings.robotsHeader, settings.canonical],
    [200, 'noindex', 'noindex', null],
  );
  for (const route of ['/no-such-page', '/c/no-such-challenge']) {
    const page = await head(route);
    assert.deepEqual([page.status, page.robots], [404, 'noindex'], route);
  }
  for (const [from, to] of [
    ['/privacy/', '/privacy'],
    ['/index.html', '/'],
    // Never to another site: browsers read "//example.com" and "/\\example.com" as one.
    ['//example.com/', '/example.com'],
    ['/\\example.com/', '/example.com'],
  ]) {
    const res = await get(from);
    assert.deepEqual([res.status, res.headers.get('location')], [301, to], from);
  }
  const icon = await get('/favicon.ico');
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('content-type') ?? '', /icon/);
});

test('search engines get the public pages in a sitemap and, on the home page only, the site name', {
  skip: !built,
}, async () => {
  const text = async (route: string) => (await fetch(`${srv.url}${route}`)).text();
  const sitemap = await text('/sitemap.xml');
  const listed = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(
    listed,
    Object.keys(PUBLIC_PAGES).map((route) => `https://${BRAND.domain}${route}`),
  );
  const robots = await text('/robots.txt');
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Allow: \/api\/legal$/m);
  assert.match(robots, new RegExp(`^Sitemap: https://${BRAND.domain}/sitemap.xml$`, 'm'));

  const data = (html: string) =>
    [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const [site, ...more] = data(await text('/'));
  assert.equal(more.length, 0);
  assert.equal(site['@type'], 'WebSite');
  assert.equal(site.name, BRAND.name);
  assert.equal(site.url, 'https://almanac.test/');
  assert.equal(site.publisher.name, 'Тест Тестов');
  for (const route of ['/privacy', '/settings', '/no-such-page']) assert.deepEqual(data(await text(route)), [], route);
});

const paintable = fs.existsSync(path.resolve(import.meta.dirname, '../../web/dist-ssr/paint.mjs'));

test('the landing page and the legal pages arrive drawn; with a session, the app draws the lobby itself', {
  skip: !built || !paintable,
}, async () => {
  const get = async (route: string, cookie?: string) => {
    const res = await fetch(`${srv.url}${route}`, { headers: cookie ? { cookie } : {} });
    const html = await res.text();
    return { html, vary: res.headers.get('vary'), root: /<div id="root"[^>]*>/.exec(html)?.[0] };
  };
  const session = 'quiz_session=anything';

  const landing = await get('/');
  assert.equal(landing.root, '<div id="root" data-painted="signed-out">');
  assert.match(landing.html, /Онлайн викторина срещу истински хора/);
  assert.match(landing.html, /Играй като гост/);
  // Nothing drawn invisible, waiting for an entrance animation that only the browser would play.
  assert.doesNotMatch(landing.html, /opacity:0/);
  assert.match(landing.vary ?? '', /cookie/i);
  const lobby = await get('/', session);
  assert.equal(lobby.root, '<div id="root">');
  assert.doesNotMatch(lobby.html, /Онлайн викторина/);
  // A device that has signed in before gets that version drawn (the form on "Вход"), so nothing flips as it hydrates.
  const back = await get('/', 'quiz_returning=1');
  assert.equal(back.root, '<div id="root" data-painted="signed-out" data-returning="1">');
  assert.match(back.html, /Здравей отново!/);
  assert.match(landing.html, /Създай профил/);

  // The legal pages read the same for everyone, and name who runs the site in the text itself.
  for (const cookie of [undefined, session]) {
    const privacy = await get('/privacy', cookie);
    assert.equal(privacy.root, '<div id="root" data-painted="">');
    assert.match(privacy.html, /<b>Тест Тестов<\/b>, физическо лице/);
  }
  const terms = await get('/terms');
  assert.equal(terms.root, '<div id="root" data-painted="">');
  // Whole as sent: no section left as a spinner for a script to swap in (React does that to a big one unless told not
  // to, and without scripts the spinner would be the page).
  for (const page of [landing, back, terms, await get('/privacy')]) {
    assert.doesNotMatch(page.html, /<!--\$\?-->|<template id="B:/);
    assert.match(page.html, /<main>/);
  }

  // Every page carries who runs the site, for the footer and the legal pages; the game's own screens aren't drawn.
  const settings = await get('/settings');
  assert.equal(settings.root, '<div id="root">');
  const operator = /<script type="application\/json" id="operator">([^<]*)<\/script>/.exec(settings.html)?.[1];
  assert.equal((JSON.parse(operator ?? 'null') as OperatorInfo | null)?.name, 'Тест Тестов');
});

test('the server knows every screen of the app (else it would answer it with a 404)', () => {
  const app = fs.readFileSync(path.resolve(import.meta.dirname, '../../web/src/App.tsx'), 'utf8');
  const routes = [...app.matchAll(/<Route path="([^"*]+)"/g)].map((m) => m[1].replace(/:[a-z]+/g, 'x1'));
  assert.ok(routes.length > 15, `found ${routes.length} routes`);
  for (const route of routes) assert.notEqual(routeKind(route), 'unknown', route);
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
  assert.match(closed.error, /„Дуел“ или „Роял“/);
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
