import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * One-time codes from an authenticator app (TOTP, RFC 6238: HMAC-SHA1, 30-second steps, six digits), the second factor
 * staff sign in to /admin with. A shared secret per account, in base32 as the apps take it.
 */

const STEP_MS = 30_000;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes: Buffer): string {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[Number.parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

export function fromBase32(text: string): Buffer {
  let bits = '';
  for (const c of text.toUpperCase().replace(/[\s=-]/g, '')) {
    const v = ALPHABET.indexOf(c);
    if (v === -1) throw new Error('Not base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** A new secret: 160 bits, as RFC 4226 recommends. */
export const newSecret = () => base32(randomBytes(20));

/** The code for a step (`digits` 8 for the RFC's own test vectors). */
export function codeAt(secret: string, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const value = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (now: number) => Math.floor(now / STEP_MS);

/**
 * The step a code was made for, if it's right for now (a step either side, for a clock a little off) and newer than
 * the last one taken (`after`: a code works once); null otherwise.
 */
export function verify(secret: string, code: string, now = Date.now(), after = -1): number | null {
  const typed = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const current = stepAt(now);
  for (const step of [current - 1, current, current + 1]) {
    if (step <= after) continue;
    if (timingSafeEqual(Buffer.from(codeAt(secret, step)), Buffer.from(typed))) return step;
  }
  return null;
}

/** What an authenticator app scans or opens: the issuer and the account, and the secret. */
export function otpauthUri(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=30`;
}
