// Passkeys as a staff second factor (src/passkeys.ts), through the real ceremonies: a software authenticator here makes
// a key pair, answers the server's challenges as a browser and a device would (a "none" attestation, signed
// assertions), and the server checks them with its WebAuthn library.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto';
import { after, before, test } from 'node:test';
import { cli, http, register, startServer, type TestServer } from './helpers';

let srv: TestServer;
let api: ReturnType<typeof http>;

before(async () => {
  srv = await startServer();
  api = http(srv.url);
});

after(async () => {
  await srv?.stop();
});

/** The site the test server says it is (APP_URL in helpers.ts): what the keys are bound to. */
const SITE = { id: 'almanac.test', origin: 'https://almanac.test' };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';

// ─── A software authenticator ────────────────────────────────────────────────────────────────────────────────────────

/** The CBOR WebAuthn needs: whole numbers, bytes, text, and maps of them. */
function cbor(value: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65_536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
    const b = Buffer.alloc(5);
    b[0] = (major << 5) | 26;
    b.writeUInt32BE(n, 1);
    return b;
  };
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') {
    const text = Buffer.from(value);
    return Buffer.concat([head(3, text.length), text]);
  }
  const entries = value instanceof Map ? [...value] : Object.entries(value as object);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest();
const b64u = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/** A device with one passkey on it: a P-256 key pair (ES256) and a credential id. */
class Authenticator {
  readonly id = randomBytes(16);
  private readonly key: KeyObject;
  private readonly cose: Buffer;
  private count = 0;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.key = privateKey;
    const { x, y } = publicKey.export({ format: 'jwk' });
    // kty EC2, alg ES256, crv P-256, x, y.
    this.cose = cbor(
      new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(x!, 'base64url')],
        [-3, Buffer.from(y!, 'base64url')],
      ]),
    );
  }

  private authData(attested: boolean) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(++this.count);
    // User present and verified; with the new key's data when it's made.
    const flags = Buffer.from([attested ? 0x45 : 0x05]);
    const parts: Buffer[] = [sha256(SITE.id), flags, counter];
    if (attested) {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(this.id.length);
      parts.push(Buffer.alloc(16), length, this.id, this.cose);
    }
    return Buffer.concat(parts);
  }

  /** The browser's answer to a registration's options (navigator.credentials.create, as JSON). */
  create(options: { challenge: string }, origin = SITE.origin) {
    const clientDataJSON = JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin });
    const attestationObject = cbor({ fmt: 'none', attStmt: {}, authData: this.authData(true) });
    return {
      id: b64u(this.id),
      rawId: b64u(this.id),
      type: 'public-key',
      response: {
        clientDataJSON: b64u(clientDataJSON),
        attestationObject: b64u(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** The browser's answer to a sign-in's options (navigator.credentials.get, as JSON), signed with the key. */
  get(options: { challenge: string }, origin = SITE.origin) {
    const clientDataJSON = JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin });
    const authenticatorData = this.authData(false);
    const signature = sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), this.key);
    return {
      id: b64u(this.id),
      rawId: b64u(this.id),
      type: 'public-key',
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authenticatorData),
        signature: b64u(signature),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}

/** A request with the browser's User-Agent (the server names a new passkey after the device). */
async function send(method: string, path: string, cookie: string, body?: unknown) {
  const r = await fetch(`${srv.url}${path}`, {
    method,
    headers: { cookie, 'user-agent': IPHONE, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // biome-ignore lint/suspicious/noExplicitAny: tests read whichever fields of a route's JSON they assert on
  return { status: r.status, body: (await r.json()) as any };
}

async function staffMember(name: string) {
  const account = await register(srv.url, name);
  // A verified address: the staff member hears of each passkey added or removed, and of each sign-in.
  srv.db
    .prepare('UPDATE users SET email = ?, email_key = ? WHERE id = ?')
    .run(`${name}@example.test`, `${name}@example.test`, account.user.id);
  assert.equal(cli(srv.dbPath, 'admin', 'add', name).status, 0);
  return account;
}

/** A new session for the account, as signing in again on another day: its second factor still to give. */
async function signInAgain(name: string) {
  const login = await api.send('POST', '/api/auth/login', '', { username: name, password: 'secret123' });
  assert.equal(login.status, 200);
  return login.cookie!;
}

const summary = async (cookie: string) => (await api.get('/api/admin/summary', cookie)).body.secondFactor;

async function signInWithKey(device: Authenticator, cookie: string, origin?: string) {
  const options = await send('POST', '/api/auth/2fa/passkey/options', cookie);
  assert.equal(options.status, 200, JSON.stringify(options.body));
  return send('POST', '/api/auth/2fa/passkey', cookie, { response: device.get(options.body, origin) });
}

// ─── The tests ───────────────────────────────────────────────────────────────────────────────────────────────────────

test('a passkey is a second factor of its own: made with the password, then /admin with it alone', async () => {
  const { cookie } = await staffMember('klyuchar');
  const phone = new Authenticator();
  assert.equal(await summary(cookie), 'setup');

  const options = await send('POST', '/api/auth/2fa/passkeys/options', cookie);
  assert.equal(options.status, 200, JSON.stringify(options.body));
  assert.equal(options.body.rp.id, SITE.id);
  const made = await send('POST', '/api/auth/2fa/passkeys', cookie, { response: phone.create(options.body) });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  // On with it, and given for this session (as the app's first code is).
  assert.equal(await summary(cookie), 'ok');
  const methods = await send('GET', '/api/auth/2fa/methods', cookie);
  assert.equal(methods.body.code, false);
  assert.deepEqual(
    methods.body.passkeys.map((p: { id: string; name: string; usedAt: number | null }) => [p.id, p.name, p.usedAt]),
    [[b64u(phone.id), 'iPhone', null]],
  );
  assert.match(cli(srv.dbPath, 'admin', 'list').output, /klyuchar\tmoderator\t2FA on \(1 passkey\)/);
  assert.ok(srv.mails().some((m) => m.subject.startsWith('Нов ключ за достъп')));

  // Another day: the password, then the key.
  const later = await signInAgain('klyuchar');
  assert.equal(await summary(later), 'needed');
  const given = await signInWithKey(phone, later);
  assert.equal(given.status, 200, JSON.stringify(given.body));
  assert.equal(await summary(later), 'ok');
  assert.ok((await send('GET', '/api/auth/2fa/methods', later)).body.passkeys[0].usedAt > 0);
  assert.ok(srv.mails().some((m) => /с паролата и ключ за достъп/.test(m.text)));
});

test("a passkey answers only its own challenge, once, from the site, and only for its owner's account", async () => {
  const { cookie } = await staffMember('pazach');
  const phone = new Authenticator();
  const options = await send('POST', '/api/auth/2fa/passkeys/options', cookie);
  assert.equal(
    (await send('POST', '/api/auth/2fa/passkeys', cookie, { response: phone.create(options.body) })).status,
    200,
  );
  const later = await signInAgain('pazach');

  // An answer made on another site (a look-alike page passing the challenge on): refused.
  assert.equal((await signInWithKey(phone, later, 'https://almanac-test.example')).status, 400);
  // The same answer twice: the challenge is used up by the first.
  const asked = await send('POST', '/api/auth/2fa/passkey/options', later);
  const answer = phone.get(asked.body);
  assert.equal((await send('POST', '/api/auth/2fa/passkey', later, { response: answer })).status, 200);
  const again = await signInAgain('pazach');
  assert.equal((await send('POST', '/api/auth/2fa/passkey', again, { response: answer })).status, 400);
  assert.equal(await summary(again), 'needed');

  // Someone else's passkey, on this account: not this account's key.
  const other = await staffMember('drug_pazach');
  const theirs = new Authenticator();
  const theirOptions = await send('POST', '/api/auth/2fa/passkeys/options', other.cookie);
  await send('POST', '/api/auth/2fa/passkeys', other.cookie, { response: theirs.create(theirOptions.body) });
  assert.equal((await signInWithKey(theirs, again)).status, 400);
  assert.equal(await summary(again), 'needed');
});

test('codes on hold (someone trying the password) leave a passkey working; a reset or a removal takes it away', async () => {
  const { cookie, user } = await staffMember('blokiran');
  const phone = new Authenticator();
  const options = await send('POST', '/api/auth/2fa/passkeys/options', cookie);
  const made = await send('POST', '/api/auth/2fa/passkeys', cookie, { response: phone.create(options.body) });
  assert.equal(made.status, 200);

  // A hundred wrong codes stop the app's codes (secondFactor.ts): the passkey has nothing to guess, and still works.
  srv.db.prepare('UPDATE users SET totp_failures = 100, totp_failed_at = ? WHERE id = ?').run(Date.now(), user.id);
  const later = await signInAgain('blokiran');
  assert.equal((await signInWithKey(phone, later)).status, 200);
  assert.equal(await summary(later), 'ok');

  // Removed (with the password given within the hour): the last factor gone, /admin asks for one to be set up.
  const removed = await send('DELETE', `/api/auth/2fa/passkeys/${b64u(phone.id)}`, later);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(await summary(later), 'setup');
  assert.ok(srv.mails().some((m) => m.subject.startsWith('Премахнат ключ за достъп')));

  // A new one, then the owner's reset from the server: gone with the app's secret.
  const again = await send('POST', '/api/auth/2fa/passkeys/options', later);
  await send('POST', '/api/auth/2fa/passkeys', later, { response: new Authenticator().create(again.body) });
  assert.equal(cli(srv.dbPath, 'admin', '2fa-reset', 'blokiran').status, 0);
  assert.deepEqual((await send('GET', '/api/auth/2fa/methods', later)).body.passkeys, []);
});

test('only staff make or use passkeys, and making one needs the password given within the hour', async () => {
  const player = await register(srv.url, 'prost_igrach');
  assert.equal((await send('POST', '/api/auth/2fa/passkeys/options', player.cookie)).status, 403);
  assert.equal((await send('POST', '/api/auth/2fa/passkey/options', player.cookie)).status, 403);

  // A session whose password is over an hour old: asked for it again first.
  const { user } = await staffMember('star_seans');
  const old = await signInAgain('star_seans');
  srv.db
    .prepare('UPDATE sessions SET created_at = ?, confirmed_at = NULL WHERE user_id = ?')
    .run(Date.now() - 2 * 60 * 60_000, user.id);
  const asked = await send('POST', '/api/auth/2fa/passkeys/options', old);
  assert.equal(asked.status, 403);
  assert.equal(asked.body.confirm, true);
});
