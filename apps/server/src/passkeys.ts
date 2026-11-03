import { BRAND, type StaffPasskey } from '@quiz/shared';
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { config } from './config';
import { all, one, run } from './db';
import type { UserRow } from './users';

/**
 * Passkeys (WebAuthn) as a staff second factor, beside the authenticator app or instead of it: touched or looked at,
 * not read off a phone and typed (the 31 October review, A11Y-11; WCAG 3.3.8), and bound to this site, so a look-alike
 * page can't pass one on. Nothing to guess either: the wrong-code limits (secondFactor.ts) don't apply to them, and a
 * staff member whose codes are on hold (someone else trying the password) still gets in with one.
 */

/** The site, as WebAuthn names it: its address (APP_URL), whose host the keys are bound to. */
const site = new URL(config.appUrl);
const RP = { id: site.hostname, origin: site.origin, name: BRAND.name };

/** At most this many per staff member: a phone, a laptop, a spare key, and room to spare. */
export const MAX_PASSKEYS = 10;

/** A ceremony started for a session: its challenge, which only the browser's answer within a few minutes can use. */
const pending = new Map<string, { challenge: string; kind: 'register' | 'sign-in'; until: number }>();
const PENDING_MS = 5 * 60_000;

function remember(session: string, kind: 'register' | 'sign-in', challenge: string) {
  const now = Date.now();
  for (const [key, entry] of pending) if (entry.until < now) pending.delete(key);
  pending.set(session, { challenge, kind, until: now + PENDING_MS });
}

/** The challenge this session was given for `kind`, once: a second answer to it finds nothing. */
function take(session: string, kind: 'register' | 'sign-in'): string | null {
  const entry = pending.get(session);
  pending.delete(session);
  return entry && entry.kind === kind && entry.until >= Date.now() ? entry.challenge : null;
}

interface PasskeyRow {
  id: string;
  user_id: number;
  public_key: Uint8Array;
  counter: number;
  transports: string | null;
  name: string;
  created_at: number;
  used_at: number | null;
}

const rows = (userId: number) =>
  all<PasskeyRow>('SELECT * FROM staff_passkeys WHERE user_id = ? ORDER BY created_at', userId);

/** A staff member's passkeys, as their settings list them. */
export function passkeysOf(userId: number): StaffPasskey[] {
  return rows(userId).map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at, usedAt: p.used_at }));
}

export const hasPasskey = (userId: number) =>
  !!one<{ x: number }>('SELECT 1 AS x FROM staff_passkeys WHERE user_id = ? LIMIT 1', userId);

const transportsOf = (p: PasskeyRow) => (p.transports ? (JSON.parse(p.transports) as string[]) : undefined);

/** What the browser needs to make a new passkey for this staff member (none it already has: excludeCredentials). */
export async function registrationOptions(user: UserRow, session: string) {
  const options = await generateRegistrationOptions({
    rpName: RP.name,
    rpID: RP.id,
    userName: user.username,
    userID: new TextEncoder().encode(`u${user.id}`),
    attestationType: 'none',
    excludeCredentials: rows(user.id).map((p) => ({ id: p.id, transports: transportsOf(p) })),
    // A passkey the device keeps (it can sign in without a name one day), checked with what unlocks the device.
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  remember(session, 'register', options.challenge);
  return options;
}

/**
 * The browser's new passkey, checked against the challenge this session was given and kept under `name`. False if it
 * isn't a valid one (or the challenge is gone): nothing is kept then.
 */
export async function register(user: UserRow, session: string, response: RegistrationResponseJSON, name: string) {
  const challenge = take(session, 'register');
  if (!challenge) return false;
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: RP.origin,
    expectedRPID: RP.id,
    // The password was the first factor: the key itself is the second, whether or not it asked for a fingerprint.
    requireUserVerification: false,
  }).catch(() => null);
  if (!result?.verified) return false;
  const { credential } = result.registrationInfo;
  run(
    `INSERT INTO staff_passkeys (id, user_id, public_key, counter, transports, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    credential.id,
    user.id,
    credential.publicKey,
    credential.counter,
    credential.transports ? JSON.stringify(credential.transports) : null,
    name,
    Date.now(),
  );
  return true;
}

/** What the browser needs to sign in with one of this staff member's passkeys. */
export async function signInOptions(user: UserRow, session: string) {
  const options = await generateAuthenticationOptions({
    rpID: RP.id,
    allowCredentials: rows(user.id).map((p) => ({ id: p.id, transports: transportsOf(p) })),
    userVerification: 'preferred',
  });
  remember(session, 'sign-in', options.challenge);
  return options;
}

/** One of this staff member's passkeys answered this session's challenge: its count and last use are kept. */
export async function signIn(user: UserRow, session: string, response: AuthenticationResponseJSON) {
  const challenge = take(session, 'sign-in');
  const passkey = one<PasskeyRow>('SELECT * FROM staff_passkeys WHERE id = ? AND user_id = ?', response.id, user.id);
  if (!challenge || !passkey) return false;
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: RP.origin,
    expectedRPID: RP.id,
    credential: {
      id: passkey.id,
      // A copy on its own ArrayBuffer, as the library's type asks (what SQLite hands back may share one).
      publicKey: new Uint8Array(passkey.public_key),
      counter: passkey.counter,
      transports: transportsOf(passkey),
    },
    requireUserVerification: false,
  }).catch(() => null);
  if (!result?.verified) return false;
  run(
    'UPDATE staff_passkeys SET counter = ?, used_at = ? WHERE id = ?',
    result.authenticationInfo.newCounter,
    Date.now(),
    passkey.id,
  );
  return true;
}

/** A staff member's passkey, gone: true if there was one by that id. */
export function removePasskey(userId: number, id: string): boolean {
  return run('DELETE FROM staff_passkeys WHERE id = ? AND user_id = ?', id, userId).changes > 0;
}

/**
 * A short name for a new passkey, from the device it was made on (the browser's User-Agent): „iPhone“, „Mac“,
 * „Windows“… — enough to tell one from another in the list.
 */
export function deviceName(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Ключ за достъп';
}
