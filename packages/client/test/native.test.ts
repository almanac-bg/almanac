// This package runs in React Native too: there `window` is the global object, with no addEventListener, and there's no
// `document` (react-native/Libraries/Core/setUpGlobals.js). What only a platform knows comes through ClientConfig's
// hooks. Here the client runs with React Native's globals, as the app will run it: a web-only call that slips into
// the shared code fails this test (the 31 October review, MOBILE-4).
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mock, test } from 'node:test';
import { CLIENT_HEADER, PROTOCOL, parseClient } from '@almanac/shared';

Object.assign(globalThis, { window: globalThis });
Object.defineProperty(globalThis, 'navigator', { value: { product: 'ReactNative' }, configurable: true });
assert.equal(typeof (globalThis as { addEventListener?: unknown }).addEventListener, 'undefined');
assert.equal(typeof (globalThis as { document?: unknown }).document, 'undefined');

class FakeManager extends EventEmitter {
  reconnectionDelay() {
    return this;
  }
  randomizationFactor() {
    return this;
  }
}
class FakeSocket extends EventEmitter {
  connected = false;
  active = false;
  io = new FakeManager();
  calls: string[] = [];
  onAny() {
    return this;
  }
  connect() {
    this.calls.push('connect');
    this.active = true;
    return this;
  }
  disconnect() {
    this.calls.push('disconnect');
    return this;
  }
}
let options: Record<string, unknown> = {};
const socket = new FakeSocket();
mock.module('socket.io-client', {
  namedExports: {
    io: (_url: string, given: Record<string, unknown>) => {
      options = given;
      return socket;
    },
  },
});
const { api, configureClient, connectRealtime } = await import('../src/index.ts');

const resumed: (() => void)[] = [];
const online: (() => void)[] = [];
let session = 'first-session';
configureClient({
  baseUrl: 'https://almanac.test',
  client: 'android',
  build: '1.0.0+1',
  onResume: (listener) => resumed.push(listener),
  onOnline: (listener) => online.push(listener),
  authHeaders: () => ({ authorization: `Bearer ${session}` }),
  socketAuth: () => ({ token: session }),
});

const sent: { url: string; headers: Headers }[] = [];
globalThis.fetch = async (input, init) => {
  sent.push({ url: String(input), headers: new Headers(init?.headers) });
  return Response.json({ user: null });
};

test('the socket connects with no window events and no document', async () => {
  await connectRealtime();
  assert.deepEqual(socket.calls, ['connect']);
  assert.equal(resumed.length, 2, 'the link watch and the retry both listen through onResume');
  assert.equal(online.length, 1);
});

test("the socket's auth is asked at each connection: the session as it is then, and the client", async () => {
  const auth = () => new Promise((resolve) => (options.auth as (send: (value: unknown) => void) => void)(resolve));
  assert.deepEqual(await auth(), { token: 'first-session', client: 'android', protocol: PROTOCOL, build: '1.0.0+1' });
  session = 'second-session';
  assert.equal(((await auth()) as { token: string }).token, 'second-session');
  assert.deepEqual(parseClient(await auth()), { client: 'android', protocol: PROTOCOL, build: '1.0.0+1' });
});

test('an /api request carries the app session and the client, to the configured server', async () => {
  session = 'first-session';
  await api.me();
  const { url, headers } = sent.at(-1)!;
  assert.equal(url, 'https://almanac.test/api/me');
  assert.equal(headers.get('authorization'), 'Bearer first-session');
  assert.deepEqual(parseClient(headers.get(CLIENT_HEADER)), {
    client: 'android',
    protocol: PROTOCOL,
    build: '1.0.0+1',
  });
});

test('back in the foreground, or back online: a dropped socket tries again at once', () => {
  socket.calls = [];
  socket.connected = false;
  for (const listener of [...resumed, ...online]) listener();
  assert.deepEqual(socket.calls, ['disconnect', 'connect', 'disconnect', 'connect']);
  socket.calls = [];
  socket.connected = true;
  for (const listener of [...resumed, ...online]) listener();
  assert.deepEqual(socket.calls, [], 'a live one is left alone');
});
