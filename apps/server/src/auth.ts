import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { parseCookie, stringifySetCookie } from 'cookie';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { one, run } from './db';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'quiz_session';
const SESSION_MS = config.sessionDays * 24 * 60 * 60 * 1000;

/** Thrown when too many password checks are already queued; the API answers 503. */
export class ServerBusyError extends Error {}

/**
 * Password hashing is deliberately slow (and runs on the small libuv thread pool that file serving shares), so only a
 * few run at once: a flood of login attempts queues up instead of starving everything else, and past a point is refused.
 */
const MAX_HASHING = 4;
const MAX_WAITING = 64;
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
    const hash = await scrypt(password, salt, 64);
    return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
  });
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return withHashingSlot(async () => {
    const [scheme, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
    return timingSafeEqual(actual, expected);
  });
}

/** Checked when the login doesn't exist, so a wrong username takes as long as a wrong password (no account probing). */
export const DUMMY_PASSWORD_HASH = `scrypt$${randomBytes(16).toString('base64')}$${randomBytes(64).toString('base64')}`;

/** Sessions are stored hashed: a leaked database or backup holds no usable logins. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

/** The account is in use: it won't be deleted as unused, and any warning that it would be no longer stands. */
function seen(userId: number, now: number) {
  run('UPDATE users SET last_seen_at = ?, inactivity_warned_at = NULL WHERE id = ?', now, userId);
}

export function createSession(userId: number): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  run(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    hashToken(token),
    userId,
    now,
    now + SESSION_MS,
  );
  seen(userId, now);
  return token;
}

export function destroySession(token: string) {
  run('DELETE FROM sessions WHERE token = ?', hashToken(token));
}

export function sessionTokenFromCookieHeader(header: string | undefined): string | null {
  if (!header) return null;
  return parseCookie(header)[SESSION_COOKIE] ?? null;
}

/**
 * The user behind a session token. Expired sessions are deleted; a banned player's sessions don't work however they
 * were obtained (login, password reset…). Sessions slide: one used in the second half of its life is extended
 * (`renewed`), so active players never get logged out.
 */
export function resolveSession(token: string | null): { userId: number; renewed: boolean } | null {
  if (!token) return null;
  const hash = hashToken(token);
  const session = one<{ user_id: number; expires_at: number; banned_until: number | null }>(
    'SELECT s.user_id, s.expires_at, u.banned_until FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
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
  return { userId: session.user_id, renewed };
}

export const userIdFromCookieHeader = (header: string | undefined) =>
  resolveSession(sessionTokenFromCookieHeader(header))?.userId ?? null;

/** The signed-in user of a request. When the session slides forward, the cookie is renewed too (else browsers drop it). */
export function userIdFromRequest(req: Request, res: Response): number | null {
  const token = sessionTokenFromCookieHeader(req.headers.cookie);
  const session = resolveSession(token);
  if (session?.renewed) setSessionCookie(res, token);
  return session?.userId ?? null;
}

export function setSessionCookie(res: Response, token: string | null) {
  res.append(
    'Set-Cookie',
    stringifySetCookie({
      name: SESSION_COOKIE,
      value: token ?? '',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/',
      maxAge: token ? SESSION_MS / 1000 : 0,
    }),
  );
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
