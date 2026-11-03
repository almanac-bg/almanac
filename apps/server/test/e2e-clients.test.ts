// End-to-end, which clients the server takes: each says what it is and which protocol it speaks (packages/shared →
// client.ts), on the socket and on every /api request, and one older than its platform's minimum is told to update.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { CLIENT_HEADER, clientHeader, PROTOCOL, parseClient, UPDATE_REQUIRED } from '@almanac/shared';
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
