// End-to-end, which clients the server takes: each says what it is and which protocol it speaks (packages/shared →
// client.ts), on the socket and on every /api request, and one older than its platform's minimum is told to update;
// and how an app, which keeps no cookies, holds its session.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { type AppSession, CLIENT_HEADER, clientHeader, PROTOCOL, parseClient, UPDATE_REQUIRED } from '@almanac/shared';
import { io } from 'socket.io-client';
import { type Account, guest, startServer, type TestServer } from './helpers';

const T = { timeout: 60_000 };

let srv: TestServer;
let A: Account;

before(async () => {
  srv = await startServer();
  A = await guest(srv.url);
});

after(() => srv?.stop());

test('what a client says it is: the header text or the socket auth, anything else is nothing', () => {
  assert.deepEqual(parseClient('web 1 5c7bdf4'), { client: 'web', protocol: 1, build: '5c7bdf4' });
  assert.deepEqual(parseClient(' ios 3 1.4.0+27 '), { client: 'ios', protocol: 3, build: '1.4.0+27' });
  assert.deepEqual(parseClient('android 2'), { client: 'android', protocol: 2, build: '' });
  assert.deepEqual(parseClient({ client: 'web', protocol: 1, build: 'abc' }), {
    client: 'web',
    protocol: 1,
    build: 'abc',
  });
  const info = { client: 'android', protocol: PROTOCOL, build: '2.0.1' } as const;
  assert.deepEqual(parseClient(clientHeader(info)), info, 'what the client sends is what the server reads');
  for (const junk of [
    undefined,
    null,
    '',
    'web',
    'web one x',
    'web 1.5 x',
    'web -1 x',
    'desktop 1 x',
    'web 1 x y',
    `web 1 ${'x'.repeat(65)}`,
    'web 1 <script>',
    { client: 'web', protocol: '1' },
    { client: 'web' },
    {},
    42,
  ])
    assert.equal(parseClient(junk), null, JSON.stringify(junk));
});

const me = (header?: string) =>
  fetch(`${srv.url}/api/me`, {
    headers: { cookie: A.cookie, ...(header === undefined ? {} : { [CLIENT_HEADER]: header }) },
  });

test('/api refuses a client older than its platform takes, with 426 and update-required', T, async () => {
  for (const header of [`web ${PROTOCOL - 1} old`, 'ios 0 1.0.0', 'android 0 1.0.0']) {
    const res = await me(header);
    assert.equal(res.status, 426, header);
    const body = (await res.json()) as { error: string; code: string };
    assert.equal(body.code, UPDATE_REQUIRED, header);
    assert.match(body.error, /обнови/, header);
  }
  // A write is refused the same way, before anything it would change.
  const write = await fetch(`${srv.url}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie: A.cookie, [CLIENT_HEADER]: 'web 0 old' },
  });
  assert.equal(write.status, 426);
  assert.equal((await me()).status, 200, 'the session is still there');
});

test('/api takes a current client, and one that says nothing usable (a script, a health check)', T, async () => {
  for (const header of [
    `web ${PROTOCOL} new`,
    `ios ${PROTOCOL} 1.0.0`,
    `android ${PROTOCOL + 1} 9.9.9`,
    'nonsense',
    undefined,
  ])
    assert.equal((await me(header)).status, 200, String(header));
});

/** Connects with this `auth` and resolves with how it went: "connected", or the refusal's message. */
function connectAs(auth: Record<string, unknown> | undefined, cookie = A.cookie) {
  const socket = io(srv.url, {
    transports: ['websocket'],
    extraHeaders: { cookie },
    forceNew: true,
    reconnection: false,
    auth,
  });
  return new Promise<string>((resolve) => {
    socket.on('connect', () => resolve('connected'));
    socket.on('connect_error', (err) => resolve(err.message));
  }).finally(() => socket.close());
}

test(
  'a socket too old for the protocol is refused with update-required, before its session is even looked at',
  T,
  async () => {
    assert.equal(await connectAs({ client: 'web', protocol: PROTOCOL - 1, build: 'old' }), UPDATE_REQUIRED);
    assert.equal(await connectAs({ client: 'ios', protocol: 0, build: '1.0.0' }), UPDATE_REQUIRED);
    // Signed out too: an update, not a sign-in, is what it needs first.
    assert.equal(await connectAs({ client: 'android', protocol: 0, build: '1.0.0' }, ''), UPDATE_REQUIRED);
    assert.equal(await connectAs({ client: 'web', protocol: PROTOCOL, build: 'new' }, ''), 'unauthorized');
    assert.equal(await connectAs({ client: 'web', protocol: PROTOCOL, build: 'new' }), 'connected');
    assert.equal(await connectAs(undefined), 'connected', 'one that says nothing is let through');
  },
);

// An app keeps no cookies: a new session comes to it in the answer, and goes back as `Authorization: Bearer` (and in
// the socket's `auth`). A web page never gets one that way (the 31 October review, 8n.6).
const APP = { 'x-almanac-client': `ios ${PROTOCOL} 1.0.0+1`, 'content-type': 'application/json' };
const signUpApp = (username: string, headers: Record<string, string> = {}) =>
  fetch(`${srv.url}/api/auth/register`, {
    method: 'POST',
    headers: { ...APP, ...headers },
    body: JSON.stringify({ username, password: 'secret123' }),
  });

test(
  'an app signs up and gets its session in the answer, not as a cookie, and uses it as a Bearer token',
  T,
  async () => {
    const res = await signUpApp('prilozhenie');
    assert.equal(res.status, 201);
    const { session, user } = (await res.json()) as { session: AppSession; user: { id: number } };
    assert.match(session.token, /^[\w-]{43}$/);
    assert.match(session.device!, /^[\w-]+\.[\w-]+$/);
    assert.deepEqual(res.headers.getSetCookie(), [], 'no cookie for an app');
    const me = (token: string) =>
      fetch(`${srv.url}/api/me`, { headers: { ...APP, authorization: `Bearer ${token}` } }).then((r) => r.json());
    assert.equal(((await me(session.token)) as { user: { id: number } }).user.id, user.id);

    // The socket: the token in its auth.
    const socket = io(srv.url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: session.token, client: 'ios', protocol: PROTOCOL, build: '1.0.0+1' },
    });
    assert.equal(
      await new Promise<string>((resolve) => {
        socket.on('connect', () => resolve('connected'));
        socket.on('connect_error', (err) => resolve(err.message));
      }),
      'connected',
    );
    socket.close();

    // Signing out ends that session, and the token with it.
    const out = await fetch(`${srv.url}/api/auth/logout`, {
      method: 'POST',
      headers: { ...APP, authorization: `Bearer ${session.token}` },
    });
    assert.equal(out.status, 200);
    assert.equal(((await me(session.token)) as { user: null }).user, null);
  },
);

test(
  'a page that says it is an app still gets a cookie: a session in the answer is only for what no browser sends',
  T,
  async () => {
    for (const headers of [{ origin: 'https://almanac.test' }, { 'sec-fetch-site': 'same-origin' }]) {
      const res = await signUpApp(`stranica_${'origin' in headers ? 'o' : 's'}`, headers);
      assert.equal(res.status, 201, JSON.stringify(headers));
      assert.equal(((await res.json()) as { session?: AppSession }).session, undefined, JSON.stringify(headers));
      assert.ok(
        res.headers.getSetCookie().some((c) => c.startsWith('almanac_session=')),
        JSON.stringify(headers),
      );
    }
  },
);

test(
  "an app's device mark keeps its sign-in open while wrong passwords from elsewhere run the account's out",
  T,
  async () => {
    const { session } = (await (await signUpApp('zaklyuchena_app')).json()) as { session: AppSession };
    const login = (password: string, from: string, extra: Record<string, string> = {}) =>
      fetch(`${srv.url}/api/auth/login`, {
        method: 'POST',
        headers: { ...APP, 'x-forwarded-for': from, ...extra },
        body: JSON.stringify({ username: 'zaklyuchena_app', password }),
      });
    const statuses: number[] = [];
    for (let net = 1; net <= 4; net++) {
      const tries = await Promise.all(
        Array.from({ length: 10 }, () => login('wrong-password', `198.51.100.${net + 10}`)),
      );
      statuses.push(...tries.map((r) => r.status));
    }
    assert.ok(statuses.includes(429), "the account's sign-in attempts ran out");
    assert.equal((await login('secret123', '203.0.113.19')).status, 429, 'a device it has never signed in on waits');
    const back = await login('secret123', '203.0.113.19', { 'x-almanac-device': session.device! });
    assert.equal(back.status, 200, 'the one it signed in on before does not');
    assert.ok(((await back.json()) as { session?: AppSession }).session?.token, 'and gets a session of its own');
  },
);

test('a guest app gets a session with no device mark (no password to guard)', T, async () => {
  const res = await fetch(`${srv.url}/api/auth/guest`, { method: 'POST', headers: APP });
  assert.equal(res.status, 201);
  const { session } = (await res.json()) as { session: AppSession };
  assert.ok(session.token);
  assert.equal(session.device, undefined);
});

// A route that read the cookie itself would sign an app out without a word: the session is read in one place
// (auth.ts → sessionTokenOf), besides the page (index.ts: pages are the web's) and the socket's fallback for the web.
test('no route reads the session cookie by itself', () => {
  const src = path.resolve(import.meta.dirname, '../src');
  const readers = fs
    .readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => /sessionTokenFromCookieHeader\(/.test(fs.readFileSync(path.join(src, f), 'utf8')))
    .sort();
  assert.deepEqual(readers, ['auth.ts', 'index.ts', 'realtime.ts']);
});
