// The client says what it is and which protocol it speaks (packages/shared → client.ts) — on every /api request and
// when its socket connects — and a server that no longer takes it is heard once: the web reloads, an app asks for an
// update. The server's side is in apps/server/test/e2e-clients.test.ts.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mock, test } from 'node:test';
import { CLIENT_HEADER, PROTOCOL, parseClient, UPDATE_REQUIRED } from '@almanac/shared';

class FakeSocket extends EventEmitter {
  io = new EventEmitter();
  connect() {
    return this;
  }
  onAny() {
    return this;
  }
}
const sockets: { options: Record<string, unknown>; socket: FakeSocket }[] = [];
mock.module('socket.io-client', {
  namedExports: {
    io: (_url: string, options: Record<string, unknown>) => {
      const socket = new FakeSocket();
      sockets.push({ options, socket });
      return socket;
    },
  },
});
const { api, ApiError, configureClient, connectRealtime } = await import('../src/index.ts');

let updates = 0;
configureClient({
  baseUrl: 'https://almanac.test',
  client: 'ios',
  build: '1.4.0+27',
  onUpdateRequired: () => updates++,
});

const sent: Headers[] = [];
let answer = () => Response.json({ user: null });
globalThis.fetch = async (_input, init) => {
  sent.push(new Headers(init?.headers));
  return answer();
};

test('every /api request says which client, protocol and build it is', async () => {
  await api.me();
  assert.deepEqual(parseClient(sent.at(-1)?.get(CLIENT_HEADER)), {
    client: 'ios',
    protocol: PROTOCOL,
    build: '1.4.0+27',
  });
});

test('the socket says the same in its auth', async () => {
  await connectRealtime();
  const auth = sockets[0]?.options.auth as (send: (value: unknown) => void) => void;
  const said = await new Promise((resolve) => auth(resolve));
  assert.deepEqual(parseClient(said), { client: 'ios', protocol: PROTOCOL, build: '1.4.0+27' });
});

// The socket's refusal alone: realtime.test.ts.
test('update-required from /api is passed on once, and the request still fails', async () => {
  answer = () =>
    Response.json({ error: 'Тази версия на играта е остаряла: обнови я.', code: UPDATE_REQUIRED }, { status: 426 });
  await assert.rejects(api.me(), (err) => err instanceof ApiError && err.status === 426);
  assert.equal(updates, 1);
  await assert.rejects(api.me());
  sockets[0]?.socket.emit('connect_error', new Error(UPDATE_REQUIRED));
  assert.equal(updates, 1, 'what follows the first refusal only says it again');
});
