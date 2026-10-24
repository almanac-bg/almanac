import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { parseCookie, stringifySetCookie } from 'cookie';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { one, run } from './db';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'quiz_session';
const SESSION_MS = config.sessionDays * 24 * 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

export function createSession(userId: number): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', token, userId, now, now + SESSION_MS);
  return token;
}

export function destroySession(token: string) {
  run('DELETE FROM sessions WHERE token = ?', token);
}

export function sessionTokenFromCookieHeader(header: string | undefined): string | null {
  if (!header) return null;
  return parseCookie(header)[SESSION_COOKIE] ?? null;
}

export function userIdFromCookieHeader(header: string | undefined): number | null {
  const token = sessionTokenFromCookieHeader(header);
  if (!token) return null;
  const session = one<{ user_id: number; expires_at: number }>(
    'SELECT user_id, expires_at FROM sessions WHERE token = ?',
    token,
  );
  if (!session) return null;
  const now = Date.now();
  if (session.expires_at < now) {
    destroySession(token);
    return null;
  }
  // Sessions slide: one used in the second half of its life is extended, so active players never get logged out.
  if (session.expires_at - now < SESSION_MS / 2) run('UPDATE sessions SET expires_at = ? WHERE token = ?', now + SESSION_MS, token);
  return session.user_id;
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
  const userId = userIdFromCookieHeader(req.headers.cookie);
  if (!userId) {
    res.status(401).json({ error: 'Първо влез в профила си.' });
    return;
  }
  res.locals.userId = userId;
  next();
}
