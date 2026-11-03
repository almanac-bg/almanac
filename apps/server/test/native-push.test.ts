// The apps' pushes, against stand-ins for Apple's service (APNs, HTTP/2) and Google's (FCM HTTP v1 and its OAuth token
// endpoint): a device registers with its app's session, a push reaches it signed as each service wants, a device
// the service says is gone is forgotten, and a device goes when its session does (the 31 October review, 8n.5).
import assert from 'node:assert/strict';
import { generateKeyPairSync, type KeyObject, verify } from 'node:crypto';
import http from 'node:http';
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { type AppSession, PROTOCOL } from '@almanac/shared';
import { eventually, startServer, type TestServer } from './helpers';

const T = { timeout: 60_000 };

const apnsKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const fcmKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = (key: KeyObject) => key.export({ type: 'pkcs8', format: 'pem' }) as string;

interface Seen {
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
const apnsSeen: Seen[] = [];
const fcmSeen: Seen[] = [];
const tokenRequests: URLSearchParams[] = [];
/** Devices the stand-ins answer as gone (the app was removed). */
const GONE_IOS = 'b'.repeat(64);
const GONE_ANDROID = `gone:${'x'.repeat(150)}`;

let apns: http2.Http2Server;
let fcm: http.Server;
let srv: TestServer;

const readJson = (stream: NodeJS.ReadableStream) =>
  new Promise<Record<string, unknown>>((resolve) => {
    let text = '';
    stream.on('data', (chunk) => (text += chunk));
    stream.on('end', () => resolve(text ? JSON.parse(text) : {}));
  });

before(async () => {
  apns = http2.createServer();
  apns.on('stream', async (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => {
    const body = await readJson(stream);
    apnsSeen.push({ headers: headers as Record<string, string>, body });
    const gone = headers[':path'] === `/3/device/${GONE_IOS}`;
    stream.respond({ ':status': gone ? 410 : 200, 'content-type': 'application/json' });
    stream.end(gone ? JSON.stringify({ reason: 'Unregistered' }) : '');
  });
  await new Promise<void>((resolve) => apns.listen(0, '127.0.0.1', resolve));

  fcm = http.createServer(async (req, res) => {
    if (req.url === '/token') {
      let text = '';
      for await (const chunk of req) text += chunk;
      tokenRequests.push(new URLSearchParams(text));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'fcm-access-token', expires_in: 3600 }));
      return;
    }
    const body = await readJson(req);
    fcmSeen.push({ headers: req.headers as Record<string, string>, body });
    const gone = (body.message as { token: string }).token === GONE_ANDROID;
    res.writeHead(gone ? 404 : 200, { 'content-type': 'application/json' });
    res.end(gone ? JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }) : '{}');
  });
  await new Promise<void>((resolve) => fcm.listen(0, '127.0.0.1', resolve));
  const fcmUrl = `http://127.0.0.1:${(fcm.address() as AddressInfo).port}`;

  srv = await startServer({
    APNS_KEY_ID: 'KEY1234567',
    APNS_TEAM_ID: 'TEAM123456',
    // As .env holds it: one line, its breaks as \n.
    APNS_KEY: pem(apnsKey.privateKey).replace(/\n/g, '\\n'),
    APNS_TOPIC: 'bg.almanac.app',
    APNS_URL: `http://127.0.0.1:${(apns.address() as AddressInfo).port}`,
    FCM_SERVICE_ACCOUNT: Buffer.from(
      JSON.stringify({
        project_id: 'almanac-test',
        client_email: 'push@almanac-test.iam.gserviceaccount.com',
        private_key: pem(fcmKey.privateKey),
        token_uri: `${fcmUrl}/token`,
      }),
    ).toString('base64'),
    FCM_URL: fcmUrl,
    PUSH_QUIET: 'off',
  });
});

after(async () => {
  await srv?.stop();
  apns?.close();
  fcm?.close();
});

const app = (platform: 'ios' | 'android') => ({
  'x-almanac-client': `${platform} ${PROTOCOL} 1.0.0+1`,
  'content-type': 'application/json',
});

/** A new account, signed up from the app: its session. */
async function signUp(platform: 'ios' | 'android', username: string): Promise<AppSession> {
  const res = await fetch(`${srv.url}/api/auth/register`, {
    method: 'POST',
    headers: app(platform),
    body: JSON.stringify({ username, password: 'secret123' }),
  });
  assert.equal(res.status, 201);
  return ((await res.json()) as { session: AppSession }).session;
}

const register = (platform: 'ios' | 'android', session: AppSession, token: string, sandbox = false) =>
  fetch(`${srv.url}/api/push/devices`, {
    method: 'POST',
    headers: { ...app(platform), authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ token, sandbox }),
  });

/** A JWT's three parts, read, and whether `key` signed it. */
function readJwt(token: string, key: KeyObject, alg: 'ES256' | 'RS256') {
  const [header, claims, signature] = token.split('.');
  const signed = verify(
    'sha256',
    Buffer.from(`${header}.${claims}`),
    { key, ...(alg === 'ES256' && { dsaEncoding: 'ieee-p1363' as const }) },
    Buffer.from(signature, 'base64url'),
  );
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(claims, 'base64url').toString()),
    signed,
  };
}

test('an iPhone registers its device; the first push reaches Apple signed with the team’s key', T, async () => {
  const session = await signUp('ios', 'ayfon');
  const token = 'a'.repeat(64);
  const res = await register('ios', session, token);
  assert.equal(res.status, 200, await res.clone().text());
  await eventually(() => assert.equal(apnsSeen.length, 1));
  const [{ headers, body }] = apnsSeen;
  assert.equal(headers[':path'], `/3/device/${token}`);
  assert.equal(headers['apns-topic'], 'bg.almanac.app');
  assert.equal(headers['apns-push-type'], 'alert');
  const jwt = readJwt(headers.authorization.replace(/^bearer /, ''), apnsKey.publicKey, 'ES256');
  assert.ok(jwt.signed, "signed with the team's key");
  assert.deepEqual([jwt.header.alg, jwt.header.kid, jwt.claims.iss], ['ES256', 'KEY1234567', 'TEAM123456']);
  assert.deepEqual(body, {
    aps: {
      alert: {
        title: 'Известията работят ✓',
        body: 'Ще идват само избраните в Настройки — най-много две на ден, нищо нощем.',
      },
      sound: 'default',
      'thread-id': 'hello',
    },
    url: '/settings',
  });
  // The same device again: no second hello.
  assert.equal((await register('ios', session, token)).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(apnsSeen.length, 1);
});

test('an Android phone registers; its push goes to FCM with a token the service account signed for', T, async () => {
  const session = await signUp('android', 'androyd');
  const token = `fcm:${'y'.repeat(150)}`;
  assert.equal((await register('android', session, token)).status, 200);
  await eventually(() => assert.equal(fcmSeen.length, 1));
  const [asked] = tokenRequests;
  assert.equal(asked.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const jwt = readJwt(asked.get('assertion')!, fcmKey.publicKey, 'RS256');
  assert.ok(jwt.signed, "signed with the service account's key");
  assert.equal(jwt.claims.iss, 'push@almanac-test.iam.gserviceaccount.com');
  assert.equal(jwt.claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  const [{ headers, body }] = fcmSeen;
  assert.equal(headers.authorization, 'Bearer fcm-access-token');
  const message = body.message as Record<string, Record<string, unknown>>;
  assert.equal(message.token as unknown, token);
  assert.equal(message.notification.title, 'Известията работят ✓');
  assert.deepEqual(message.data, { url: '/settings', tag: 'hello' });
});

test('a device its service says is gone is forgotten', T, async () => {
  const ios = await signUp('ios', 'mahnat_ayfon');
  assert.equal((await register('ios', ios, GONE_IOS)).status, 200);
  const android = await signUp('android', 'mahnat_android');
  assert.equal((await register('android', android, GONE_ANDROID)).status, 200);
  await eventually(() =>
    assert.equal(
      srv.db.prepare('SELECT COUNT(*) AS n FROM push_devices WHERE token IN (?, ?)').get(GONE_IOS, GONE_ANDROID)!.n,
      0,
    ),
  );
});

test('a device goes with the session it came with: signing out stops its pushes', T, async () => {
  const session = await signUp('ios', 'izlizasht');
  const token = 'c'.repeat(64);
  assert.equal((await register('ios', session, token)).status, 200);
  assert.ok(srv.db.prepare('SELECT 1 FROM push_devices WHERE token = ?').get(token));
  await fetch(`${srv.url}/api/auth/logout`, {
    method: 'POST',
    headers: { ...app('ios'), authorization: `Bearer ${session.token}` },
  });
  assert.equal(srv.db.prepare('SELECT 1 FROM push_devices WHERE token = ?').get(token), undefined);
});

test(
  'a device is the app’s own: the platform comes from the app, the token must be one its service gives',
  T,
  async () => {
    const session = await signUp('ios', 'proverka');
    const web = await fetch(`${srv.url}/api/push/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ token: 'd'.repeat(64) }),
    });
    assert.equal(web.status, 400, 'not from a page');
    for (const token of ['d'.repeat(63), `${'d'.repeat(63)}/`, '../../x', `fcm:${'y'.repeat(150)}`])
      assert.equal((await register('ios', session, token)).status, 400, token);
  },
);
