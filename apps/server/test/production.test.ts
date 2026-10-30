// The server as it runs in production (NODE_ENV=production): admins, browser hardening, health, what it refuses.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { BRAND, PUBLIC_PAGES, routeKind, type SiteInfo } from '@quiz/shared';
import { cli, connect, connected, emitAck, http, next, register, startServer, type TestServer } from './helpers';

let srv: TestServer;
// Error reporting on, pointed at a port nothing listens on (reports are dropped quietly).
const DSN = 'http://public@127.0.0.1:9/1';

before(async () => {
  // PUBLIC_QUEUES as it ships (unset): every ranked queue is open.
  srv = await startServer({
    NODE_ENV: 'production',
    PUBLIC_QUEUES: '',
    SENTRY_DSN: DSN,
    OPERATOR_NAME: 'Тест Тестов',
    OPERATOR_ADDRESS: 'ул. Примерна 1, София',
    SOURCE_URL: 'https://example.test/almanac',
    BACKUP_PROVIDER: 'Примерни бекъпи',
    PROXY_PROVIDER: 'Примерно прокси',
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
  assert.match(cli(srv.dbPath, 'admin', 'list').output, /Собственик\tmoderator\t2FA not set up/);
  assert.equal((await api.get('/api/me', owner.cookie)).body.user.staffRole, 'moderator');
  assert.equal(cli(srv.dbPath, 'admin', 'owner', 'Собственик').status, 0);
  assert.equal((await api.get('/api/me', owner.cookie)).body.user.staffRole, 'owner');
  // /admin wants an authenticator app first: what waits is counted, nothing else opens.
  assert.equal((await api.get('/api/admin/summary', owner.cookie)).body.secondFactor, 'setup');
  assert.equal((await api.get('/api/admin/reports', owner.cookie)).body.setup2fa, true);

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

test("another site's form can't sign a player out or swap their cookie for a new guest's", async () => {
  const player = await register(srv.url, 'Мишена');
  const fromElsewhere = { 'content-type': 'text/plain', origin: 'https://evil.example' };
  for (const path of ['/api/auth/logout', '/api/auth/guest']) {
    const browser = await fetch(`${srv.url}${path}`, {
      method: 'POST',
      headers: { ...fromElsewhere, 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(browser.status, 403, `${path} from another site`);
    assert.equal(browser.headers.get('set-cookie'), null, `${path} sets no cookie`);
    const older = await fetch(`${srv.url}${path}`, { method: 'POST', headers: fromElsewhere });
    assert.equal(older.status, 403, `${path} from another origin, no Sec-Fetch-Site`);
  }
  assert.equal((await http(srv.url).get('/api/me', player.cookie)).body.user.username, 'Мишена', 'still signed in');

  // The site's own pages, and callers that aren't a page at all (mail apps, Scaleway), still get through.
  const own = await fetch(`${srv.url}/api/auth/guest`, {
    method: 'POST',
    headers: { origin: 'https://almanac.test', 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(own.status, 201);
  assert.equal((await fetch(`${srv.url}/api/auth/guest`, { method: 'POST' })).status, 201);
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

test('a link to a screen of the game previews as that screen: the day, a room invite, its own address', {
  skip: !built,
}, async () => {
  const preview = async (route: string) => {
    const html = await (await fetch(`${srv.url}${route}`)).text();
    return {
      title: /<title>([^<]*)<\/title>/.exec(html)?.[1],
      url: /<meta property="og:url" content="([^"]*)"/.exec(html)?.[1],
      robots: /<meta name="robots" content="([^"]*)"/g.exec(html)?.[1],
      robotsTags: html.match(/<meta name="robots"/g)?.length,
    };
  };
  const leaderboard = await preview('/leaderboard');
  assert.equal(leaderboard.url, 'https://almanac.test/leaderboard', 'not the home page');
  const daily = await preview('/daily');
  assert.match(daily.title ?? '', /^Въпросите на деня №\d+ — /);
  assert.equal(daily.url, 'https://almanac.test/daily');
  // A link that isn't (or is no longer) anyone's: the day itself.
  assert.match((await preview('/daily/nope')).title ?? '', /^Въпросите на деня №/);
  const join = await preview('/join/123456');
  assert.match(join.title ?? '', /Покана за стая 123456/);
  for (const page of [daily, join]) assert.deepEqual([page.robots, page.robotsTags], ['noindex', 1]);
  // Only a room's code reaches a preview: any other text would show under the site's name.
  assert.equal((await preview('/join/FREE-iPhone-at-scam.example')).title, 'Покана за стая — АЛМАНАХ');
  // A player's text with `$` patterns in it is text, not a pattern: the page once ended up in its own head four times.
  const owner = await register(srv.url, 'grupa_test');
  const name = "Клас $` $& $'";
  const made = await http(srv.url).send('POST', '/api/groups', owner.cookie, { name });
  assert.equal(made.status, 200, made.body.error);
  const db = new DatabaseSync(srv.dbPath, { readOnly: true });
  const { code } = db.prepare('SELECT code FROM player_groups WHERE id = ?').get(made.body.id) as { code: string };
  db.close();
  const html = await (await fetch(`${srv.url}/groups/join/${code}`)).text();
  assert.equal(html.match(/<!doctype/gi)?.length, 1, 'the page once ended up in its own head');
  assert.equal(html.match(/<title>/g)?.length, 1);
  assert.ok(html.includes('Клас $` $&#38; $&#39;'), 'the name as typed, escaped');
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
  assert.match(landing.html, /Онлайн викторина с приятели и цяла България/);
  assert.match(landing.html, /Играй като гост/);
  // The proof line, from the bank the server has (300 test questions).
  assert.match(landing.html, /Над 300 въпроса, проверени по източници · 10 категории/);
  assert.match(landing.html, /Защо АЛМАНАХ/);
  // Nothing drawn invisible, waiting for an entrance animation that only the browser would play (the page's own
  // markup: the stylesheet, inlined, has its opacity:0 rules).
  assert.doesNotMatch(landing.html.slice(landing.html.indexOf('<div id="root"')), /opacity:0/);
  // A first visit gets the styles inside the page; the game, signed in, keeps the cached stylesheet.
  assert.match(landing.html, /<style>\/\*! tailwindcss/);
  assert.doesNotMatch(landing.html, /rel="stylesheet"/);
  assert.match(landing.vary ?? '', /cookie/i);
  const lobby = await get('/', session);
  assert.equal(lobby.root, '<div id="root">');
  assert.match(lobby.html, /rel="stylesheet"/);
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
    // A proxy in front is named, with the cookie it may set.
    assert.match(privacy.html, /<b>Защита от атаки:<\/b> (<!-- -->)?Примерно прокси/);
    assert.match(privacy.html, /<code>cf_clearance<\/code>/);
  }
  const terms = await get('/terms');
  assert.equal(terms.root, '<div id="root" data-painted="">');
  // Whole as sent: no section left as a spinner for a script to swap in (React does that to a big one unless told not
  // to, and without scripts the spinner would be the page).
  for (const page of [landing, back, terms, await get('/privacy')]) {
    assert.doesNotMatch(page.html, /<!--\$\?-->|<template id="B:/);
    assert.match(page.html, /<main[ >]/);
    // The art as files the browser keeps, at the client's own addresses: never base64 in the page.
    assert.doesNotMatch(page.html, /data:image\/webp/);
  }
  assert.match(landing.html, /src="\/assets\/[0-9a-f-]+-[\w-]+\.webp"/, 'the landing draws its art from files');

  // Every page carries who runs the site, for the footer and the legal pages; the game's own screens aren't drawn.
  const settings = await get('/settings');
  assert.equal(settings.root, '<div id="root">');
  const operator = /<script type="application\/json" id="site">([^<]*)<\/script>/.exec(settings.html)?.[1];
  assert.equal((JSON.parse(operator ?? 'null') as SiteInfo | null)?.name, 'Тест Тестов');
});

test('the server knows every screen of the app (else it would answer it with a 404)', () => {
  const app = fs.readFileSync(path.resolve(import.meta.dirname, '../../web/src/App.tsx'), 'utf8');
  // A category's quiz is a public page for each real category (an unknown one is a 404): one stands for them.
  const routes = [...app.matchAll(/<Route path="([^"*]+)"/g)].map((m) =>
    m[1].replace('/quiz/:category', '/quiz/history').replace(/:[a-z]+/g, 'x1'),
  );
  assert.ok(routes.length > 15, `found ${routes.length} routes`);
  for (const route of routes) assert.notEqual(routeKind(route), 'unknown', route);
});

test('`cli guests off` turns new guests away until `cli guests on`; accounts are unaffected', async () => {
  const off = cli(srv.dbPath, 'guests', 'off');
  assert.equal(off.status, 0, off.output);
  const refused = await fetch(`${srv.url}/api/auth/guest`, { method: 'POST' });
  assert.equal(refused.status, 503);
  assert.match(((await refused.json()) as { error: string }).error, /не приемаме нови гости/);
  await register(srv.url, 'vse_oshte_moje');
  assert.equal(cli(srv.dbPath, 'guests', 'on').status, 0);
  assert.equal((await fetch(`${srv.url}/api/auth/guest`, { method: 'POST' })).status, 201);
});

test('over HTTPS the session cookie is Secure and host-only by default; sessions under the old name still work', async () => {
  const secure = await startServer({ NODE_ENV: 'production', COOKIE_SECURE: '', OPERATOR_NAME: 'Тест Тестов' });
  try {
    const res = await fetch(`${secure.url}/api/auth/guest`, { method: 'POST' });
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith('__Host-quiz_session='));
    assert.ok(session, cookies.join(' | '));
    assert.match(session, /; Secure/i);
    assert.match(session, /; Path=\//i);
    assert.doesNotMatch(session, /Domain=/i);
    const token = session.split(';')[0].split('=')[1];
    const before = await http(secure.url).get('/api/me', `quiz_session=${token}`);
    assert.ok(before.body.user, 'a cookie issued before the prefix is still read');
  } finally {
    await secure.stop();
  }
  const typo = await startServer({ PUBLIC_QUEUES: 'duel,royal' }).catch((err: Error) => err);
  assert.ok(typo instanceof Error, 'a typo in PUBLIC_QUEUES stops the server');
  assert.match(typo.message, /PUBLIC_QUEUES has royal/);
  // A setting from before Трио joined Арена still starts the server, with Арена open in its place.
  const old = await startServer({ PUBLIC_QUEUES: 'duel,trio' });
  try {
    const player = await register(old.url, 'staro_test');
    const socket = connect(old.url, player.cookie);
    const stats = next(socket, 'lobby:stats');
    await connected(socket);
    assert.deepEqual((await stats).modes, ['duel', 'squad']);
    const closed = await emitAck(socket, 'queue:join', 'royale');
    assert.match((closed as { error: string }).error, /„Дуел“ или „Арена“/);
    socket.close();
  } finally {
    await old.stop();
  }
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

test('as it ships every ranked queue is open, and the lobby says so; Трио is no more', async () => {
  const player = await register(srv.url, 'opashka_test');
  const socket = connect(srv.url, player.cookie);
  const stats = next(socket, 'lobby:stats');
  await connected(socket);
  assert.deepEqual((await stats).modes, ['duel', 'teams', 'squad', 'royale']);
  const gone = await emitAck(socket, 'queue:join', 'trio');
  assert.deepEqual(gone, { ok: false, error: 'Непознат режим.' });
  assert.ok((await emitAck(socket, 'queue:join', 'squad')).ok);
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

test('what the site says about itself: who runs it (configuration, not code), its source, how many questions', async () => {
  const legal = (await (await fetch(`${srv.url}/api/legal`)).json()) as SiteInfo;
  assert.equal(legal.name, 'Тест Тестов');
  assert.equal(legal.address, 'ул. Примерна 1, София');
  assert.equal(legal.email, 'privacy@almanac.bg', 'a default contact address');
  assert.equal(legal.sourceUrl, 'https://example.test/almanac');
  assert.equal(legal.backups, 'Примерни бекъпи');
  assert.equal(legal.proxy, 'Примерно прокси');
  assert.equal(legal.inbox, null, 'unset: the policy leaves the line out');
  assert.equal(legal.mailbox, null);
  // The test bank has 300 questions: the landing's "над 300 въпроса", rounded down to the hundred.
  assert.equal(legal.questions, 300);
});

const webDist = path.resolve(import.meta.dirname, '../../web/dist');

test("a build file goes as its brotli copy to a browser that takes brotli, as itself to one that doesn't", {
  skip: !fs.existsSync(path.join(webDist, 'assets')) && 'web app not built',
}, async () => {
  const js = fs.readdirSync(path.join(webDist, 'assets')).find((f) => f.startsWith('index-') && f.endsWith('.js'))!;
  const br = await fetch(`${srv.url}/assets/${js}`, { headers: { 'accept-encoding': 'br' } });
  assert.equal(br.headers.get('content-encoding'), 'br');
  assert.match(br.headers.get('content-type') ?? '', /javascript/);
  assert.match(br.headers.get('cache-control') ?? '', /max-age=31536000.*immutable/);
  assert.match(br.headers.get('vary') ?? '', /Accept-Encoding/i);
  assert.ok((await br.text()).length > 1000, 'decoded by the client like any brotli response');
  const plain = await fetch(`${srv.url}/assets/${js}`, { headers: { 'accept-encoding': 'identity' } });
  assert.equal(plain.headers.get('content-encoding'), null);
  assert.match(plain.headers.get('vary') ?? '', /Accept-Encoding/i, 'a cache on the way keeps the two apart');
  const head = await fetch(`${srv.url}/assets/${js}`, { method: 'HEAD', headers: { 'accept-encoding': 'gzip, br' } });
  assert.equal(head.headers.get('content-encoding'), 'br');
  assert.match(head.headers.get('content-type') ?? '', /javascript/);
});

test('the service worker is never kept by a cache on the way; the other files beside the page for an hour', {
  skip: !fs.existsSync(path.join(webDist, 'sw.js')) && 'web app not built',
}, async () => {
  assert.equal((await fetch(`${srv.url}/sw.js`)).headers.get('cache-control'), 'no-cache');
  assert.equal((await fetch(`${srv.url}/theme.js`)).headers.get('cache-control'), 'public, max-age=3600');
});
