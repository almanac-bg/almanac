import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { promisify } from 'node:util';
import { parseCookie, stringifySetCookie } from 'cookie';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { one, run } from './db';
import { installationSecret } from './settings';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptParams & { maxmem: number },
) => Promise<Buffer>;

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}
/**
 * The cost of new password hashes: N = 2^16 (64 MiB, about 180 ms on the server), within what OWASP recommends. Each
 * hash says its own parameters, so older ones (N = 2^14, written as `scrypt$salt$hash`) still verify, and are redone
 * at the current cost on the next sign-in (needsRehash).
 */
const SCRYPT: ScryptParams = { N: 2 ** 16, r: 8, p: 1 };
const LEGACY: ScryptParams = { N: 2 ** 14, r: 8, p: 1 };
const paramsText = ({ N, r, p }: ScryptParams) => `N=${N},r=${r},p=${p}`;
// scrypt needs 128·N·r bytes; Node refuses anything over 32 MiB unless told.
const maxmem = ({ N, r }: ScryptParams) => 128 * N * r + 16 * 1024 * 1024;

function parseHash(stored: string): { params: ScryptParams; salt: string; hash: string } | null {
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt') return null;
  if (parts.length === 3) return { params: LEGACY, salt: parts[1], hash: parts[2] };
  const m = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(parts[1] ?? '');
  if (parts.length !== 4 || !m) return null;
  const params = { N: Number(m[1]), r: Number(m[2]), p: Number(m[3]) };
  // Only ever our own hashes, but a typo in one must not be able to ask for gigabytes.
  if (params.N > 2 ** 20 || params.r > 32 || params.p > 16) return null;
  return { params, salt: parts[2], hash: parts[3] };
}

/**
 * The session cookie. Over HTTPS it carries the __Host- prefix: browsers then take it only from this very host, so a
 * page on some other subdomain could never plant a session of its choosing. Sessions issued under the old name still
 * work until they lapse (30 days after the prefix shipped), and are moved to the new name as they're renewed.
 */
export const SESSION_COOKIE = config.cookieSecure ? '__Host-quiz_session' : 'quiz_session';
const OLD_SESSION_COOKIE = 'quiz_session';
const SESSION_MS = config.sessionDays * 24 * 60 * 60 * 1000;

/** Thrown when too many password checks are already queued; the API answers 503. */
export class ServerBusyError extends Error {}

/**
 * Password hashing is deliberately slow, so only a few hashes run at once: a flood of login attempts queues up instead
 * of starving everything else, and past about three seconds of queue is refused. They run on libuv's thread pool, which
 * also reads the files the site serves and looks up addresses (mail, error reports): two of its threads always stay
 * free for those, and one CPU core for the game itself.
 */
export function hashingLimits(poolSize: number, cores: number): { slots: number; waiting: number } {
  const slots = Math.max(1, Math.min(4, poolSize - 2, cores - 1));
  return { slots, waiting: slots * 16 };
}
const { slots: MAX_HASHING, waiting: MAX_WAITING } = hashingLimits(
  Number(process.env.UV_THREADPOOL_SIZE) || 4, // libuv's default
  availableParallelism(),
);
let hashing = 0;
const waiting: (() => void)[] = [];

async function withHashingSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (hashing < MAX_HASHING) hashing++;
  else if (waiting.length >= MAX_WAITING) throw new ServerBusyError('Сървърът е натоварен. Опитай след малко.');
  else await new Promise<void>((resolve) => waiting.push(resolve)); // a finishing check hands its slot over
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else hashing--;
  }
}

export function hashPassword(password: string): Promise<string> {
  return withHashingSlot(async () => {
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, 64, { ...SCRYPT, maxmem: maxmem(SCRYPT) });
    return `scrypt$${paramsText(SCRYPT)}$${salt.toString('base64')}$${hash.toString('base64')}`;
  });
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return withHashingSlot(async () => {
    const parsed = parseHash(stored);
    if (!parsed) return false;
    const expected = Buffer.from(parsed.hash, 'base64');
    const actual = await scrypt(password, Buffer.from(parsed.salt, 'base64'), expected.length, {
      ...parsed.params,
      maxmem: maxmem(parsed.params),
    });
    return timingSafeEqual(actual, expected);
  });
}

/** A hash from an older, cheaper setting: worth redoing while the password is at hand (a successful sign-in). */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith(`scrypt$${paramsText(SCRYPT)}$`);
}

/** Checked when the login doesn't exist, so a wrong username takes as long as a wrong password (no account probing). */
export const DUMMY_PASSWORD_HASH = `scrypt$${paramsText(SCRYPT)}$${randomBytes(16).toString('base64')}$${randomBytes(64).toString('base64')}`;

/** Sessions are stored hashed: a leaked database or backup holds no usable logins. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

/** The account is in use: it won't be deleted as unused, and any warning that it would be no longer stands. */
function seen(userId: number, now: number) {
  run('UPDATE users SET last_seen_at = ?, inactivity_warned_at = NULL WHERE id = ?', now, userId);
}

/** A new session; `withPassword` when the password (or a link from the account's mailbox) was just given for it. */
export function createSession(userId: number, withPassword = true): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  run(
    'INSERT INTO sessions (token, user_id, created_at, expires_at, confirmed_at) VALUES (?, ?, ?, ?, ?)',
    hashToken(token),
    userId,
    now,
    now + SESSION_MS,
    withPassword ? now : null,
  );
  seen(userId, now);
  return token;
}

export function destroySession(token: string) {
  run('DELETE FROM sessions WHERE token = ?', hashToken(token));
}

export function sessionTokenFromCookieHeader(header: string | undefined): string | null {
  if (!header) return null;
  const cookies = parseCookie(header);
  return cookies[SESSION_COOKIE] ?? cookies[OLD_SESSION_COOKIE] ?? null;
}

/**
 * The user behind a session token. Expired sessions are deleted; a banned player's sessions don't work however they
 * were obtained (login, password reset…). Sessions slide: one used in the second half of its life is extended
 * (`renewed`), so active players never get logged out.
 */
export function resolveSession(
  token: string | null,
): { userId: number; renewed: boolean; confirmedAt: number | null; secondFactorAt: number | null } | null {
  if (!token) return null;
  const hash = hashToken(token);
  const session = one<{
    user_id: number;
    expires_at: number;
    confirmed_at: number | null;
    second_factor_at: number | null;
    banned_until: number | null;
  }>(
    `SELECT s.user_id, s.expires_at, s.confirmed_at, s.second_factor_at, u.banned_until FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`,
    hash,
  );
  if (!session) return null;
  const now = Date.now();
  if (session.expires_at < now) {
    run('DELETE FROM sessions WHERE token = ?', hash);
    return null;
  }
  if (session.banned_until !== null && session.banned_until > now) return null;
  const renewed = session.expires_at - now < SESSION_MS / 2;
  if (renewed) {
    run('UPDATE sessions SET expires_at = ? WHERE token = ?', now + SESSION_MS, hash);
    seen(session.user_id, now);
  }
  return {
    userId: session.user_id,
    renewed,
    confirmedAt: session.confirmed_at,
    secondFactorAt: session.second_factor_at,
  };
}

/** A staff member's one-time code, given for this session: /admin opens for it (requireAdmin). */
export function secondFactorGiven(token: string) {
  run('UPDATE sessions SET second_factor_at = ? WHERE token = ?', Date.now(), hashToken(token));
}

/** The password, given again: the session counts as just signed in for what needs a recent one (requireRecentPassword). */
export function confirmSession(token: string) {
  run('UPDATE sessions SET confirmed_at = ? WHERE token = ?', Date.now(), hashToken(token));
}

/** The signed-in user of a request. When the session slides forward, the cookie is renewed too (else browsers drop it). */
export function userIdFromRequest(req: Request, res: Response): number | null {
  const token = sessionTokenFromCookieHeader(req.headers.cookie);
  const session = resolveSession(token);
  if (session?.renewed) setSessionCookie(res, token);
  res.locals.confirmedAt = session?.confirmedAt ?? null;
  res.locals.secondFactorAt = session?.secondFactorAt ?? null;
  return session?.userId ?? null;
}

export function setSessionCookie(res: Response, token: string | null) {
  const cookie = (name: string, value: string, maxAge: number) =>
    stringifySetCookie({
      name,
      value,
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/',
      maxAge,
    });
  res.append('Set-Cookie', cookie(SESSION_COOKIE, token ?? '', token ? SESSION_MS / 1000 : 0));
  if (SESSION_COOKIE !== OLD_SESSION_COOKIE) res.append('Set-Cookie', cookie(OLD_SESSION_COOKIE, '', 0));
}

export const DEVICE_COOKIE = 'quiz_device';
const DEVICE_MS = 365 * 24 * 60 * 60 * 1000;

const deviceSignature = (userId: number, device: string) =>
  createHmac('sha256', installationSecret('device-cookie')).update(`${userId}:${device}`).digest('base64url');

/**
 * "This device has signed in to this account before", signed with the installation's secret and sent only to the
 * sign-in addresses (/api/auth). Wrong passwords from elsewhere can use up an account's sign-in attempts for a while; a
 * device holding this has an allowance of its own, so nobody can lock a player out of their own account (see the login
 * route).
 */
export function setDeviceCookie(res: Response, userId: number) {
  const device = randomBytes(16).toString('base64url');
  res.append(
    'Set-Cookie',
    stringifySetCookie({
      name: DEVICE_COOKIE,
      value: `${device}.${deviceSignature(userId, device)}`,
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/api/auth',
      maxAge: DEVICE_MS / 1000,
    }),
  );
}

/** The device's id, when the request carries a genuine device cookie for this account; null otherwise. */
export function knownDevice(req: Request, userId: number): string | null {
  const [device, signature] = (parseCookie(req.headers.cookie ?? '')[DEVICE_COOKIE] ?? '').split('.');
  if (!device || !signature) return null;
  const [given, expected] = [Buffer.from(signature), Buffer.from(deviceSignature(userId, device))];
  return given.length === expected.length && timingSafeEqual(given, expected) ? device : null;
}

/** Puts the signed-in user's id in `res.locals.userId`, or answers 401. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = userIdFromRequest(req, res);
  if (!userId) {
    res.status(401).json({ error: 'Първо влез в профила си.' });
    return;
  }
  res.locals.userId = userId;
  next();
}
