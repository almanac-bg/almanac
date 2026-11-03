import { expect, makeModerator, type Page, signIn, signUp, test, uniqueName } from './support';

/**
 * A device with passkeys, in the page: navigator.credentials answered by a software authenticator (WebCrypto, ECDSA
 * P-256; the keys kept in the page's storage, so the same "device" still has them after signing in again), as a
 * phone's or a laptop's would. The tests' server is at an IP address, which real WebAuthn refuses as a site: the
 * server's checks (apps/server/src/passkeys.ts) are the real ones all the same.
 */
async function deviceWithPasskeys(page: Page) {
  await page.addInitScript(() => {
    const encode = new TextEncoder();
    const bytes = (b: ArrayBuffer | Uint8Array) => (b instanceof Uint8Array ? b : new Uint8Array(b));
    const b64u = (b: ArrayBuffer | Uint8Array) =>
      btoa(String.fromCharCode(...bytes(b)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    const fromB64u = (s: string) =>
      Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const concat = (...parts: Uint8Array[]) => {
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      return out;
    };
    const head = (major: number, n: number) =>
      new Uint8Array(
        n < 24 ? [(major << 5) | n] : n < 256 ? [(major << 5) | 24, n] : [(major << 5) | 25, n >> 8, n & 255],
      );
    const cbor = (v: unknown): Uint8Array => {
      if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
      if (v instanceof Uint8Array) return concat(head(2, v.length), v);
      if (typeof v === 'string') {
        const text = encode.encode(v);
        return concat(head(3, text.length), text);
      }
      const entries = v instanceof Map ? [...v] : Object.entries(v as object);
      return concat(head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)]));
    };
    const sha256 = async (data: Uint8Array) =>
      new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>));
    // WebCrypto signs as r‖s; WebAuthn's ES256 is DER.
    const der = (raw: Uint8Array) => {
      const int = (b: Uint8Array) => {
        let i = 0;
        while (i < b.length - 1 && b[i] === 0) i++;
        let v = b.slice(i);
        if (v[0] & 0x80) v = concat(new Uint8Array([0]), v);
        return concat(new Uint8Array([2, v.length]), v);
      };
      const r = int(raw.slice(0, 32));
      const s = int(raw.slice(32));
      return concat(new Uint8Array([0x30, r.length + s.length]), r, s);
    };
    type Saved = { id: string; rpId: string; key: JsonWebKey; count: number };
    const STORE = 'test:passkeys';
    const saved = (): Saved[] => JSON.parse(localStorage.getItem(STORE) ?? '[]');
    const counter = (n: number) => {
      const c = new Uint8Array(4);
      new DataView(c.buffer).setUint32(0, n);
      return c;
    };
    const credential = (id: Uint8Array, response: object) => ({
      id: b64u(id),
      rawId: id.buffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      getClientExtensionResults: () => ({}),
      response,
    });

    navigator.credentials.create = (async (options?: CredentialCreationOptions) => {
      const publicKey = options!.publicKey!;
      const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
        'sign',
        'verify',
      ])) as CryptoKeyPair;
      const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
      const id = crypto.getRandomValues(new Uint8Array(16));
      const rpId = publicKey.rp.id ?? location.hostname;
      const cose = cbor(
        new Map<number, unknown>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, fromB64u(pub.x!)],
          [-3, fromB64u(pub.y!)],
        ]),
      );
      const authData = concat(
        await sha256(encode.encode(rpId)),
        new Uint8Array([0x45]),
        counter(1),
        new Uint8Array(16),
        new Uint8Array([0, id.length]),
        id,
        cose,
      );
      const challenge = b64u(publicKey.challenge as ArrayBuffer);
      const clientData = encode.encode(JSON.stringify({ type: 'webauthn.create', challenge, origin: location.origin }));
      const key = await crypto.subtle.exportKey('jwk', pair.privateKey);
      localStorage.setItem(STORE, JSON.stringify([...saved(), { id: b64u(id), rpId, key, count: 1 }]));
      return credential(id, {
        clientDataJSON: clientData.buffer,
        attestationObject: cbor({ fmt: 'none', attStmt: {}, authData }).buffer,
        getTransports: () => ['internal'],
      });
    }) as typeof navigator.credentials.create;

    navigator.credentials.get = (async (options?: CredentialRequestOptions) => {
      const publicKey = options!.publicKey!;
      const allowed = (publicKey.allowCredentials ?? []).map((c) => b64u(c.id as ArrayBuffer));
      const all = saved();
      const found = all.find((k) => allowed.includes(k.id));
      if (!found) throw new DOMException('No passkey for this site on this device', 'NotAllowedError');
      found.count++;
      localStorage.setItem(STORE, JSON.stringify(all));
      const key = await crypto.subtle.importKey('jwk', found.key, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
        'sign',
      ]);
      const authData = concat(await sha256(encode.encode(found.rpId)), new Uint8Array([0x05]), counter(found.count));
      const challenge = b64u(publicKey.challenge as ArrayBuffer);
      const clientData = encode.encode(JSON.stringify({ type: 'webauthn.get', challenge, origin: location.origin }));
      const raw = new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          key,
          concat(authData, await sha256(clientData)) as Uint8Array<ArrayBuffer>,
        ),
      );
      return credential(fromB64u(found.id), {
        clientDataJSON: clientData.buffer,
        authenticatorData: authData.buffer,
        signature: der(raw).buffer,
        userHandle: null,
      });
    }) as typeof navigator.credentials.get;
  });
}

// A moderator's second factor as a passkey (the 31 October review, A11Y-11): made at /admin's door, used on the next
// sign-in instead of a code, listed in Settings and removed there.
test('a moderator sets up a passkey at /admin, signs in with it another day, and removes it in Settings', async ({
  page,
}) => {
  await deviceWithPasskeys(page);
  const name = uniqueName('Klyuch');
  await signUp(page, name, 'parola-123');
  makeModerator(name);

  // The door: a passkey or the app; the passkey, one touch.
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Двуфакторно влизане', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Добави ключ за достъп', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Модерация', exact: true })).toBeVisible();

  // Another day (a new session): the password, then the key — no code to type.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Изход', exact: true }).click();
  await page.getByRole('button', { name: 'Излез', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await signIn(page, name, 'parola-123');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Вход в модерацията', exact: true })).toBeVisible();
  await expect(page.getByLabel('Код от приложението')).toHaveCount(0);
  await page.getByRole('button', { name: 'Влез с ключ за достъп', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Модерация', exact: true })).toBeVisible();

  // Settings list it, and take it away (the password was given at sign-in, within the hour).
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Ключове за достъп до модерацията', exact: true })).toBeVisible();
  await expect(page.getByText(/^добавен .* · последно /)).toBeVisible();
  await page.getByRole('button', { name: /^Премахни ключа/ }).click();
  await expect(page.getByRole('button', { name: /^Премахни ключа/ })).toHaveCount(0);
  // With no second factor left, /admin asks for one again.
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Двуфакторно влизане', exact: true })).toBeVisible();
});
