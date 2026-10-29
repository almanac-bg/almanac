import { Router } from 'express';
import { z } from 'zod';
import { getMe } from '../account';
import {
  confirmSession,
  createSession,
  DUMMY_PASSWORD_HASH,
  destroySession,
  hashPassword,
  hashToken,
  knownDevice,
  needsRehash,
  requireAuth,
  sessionTokenFromCookieHeader,
  setDeviceCookie,
  setSessionCookie,
  userIdFromRequest,
  verifyPassword,
} from '../auth';
import { config } from '../config';
import { isUniqueViolation, one, run } from '../db';
import {
  EmailSchema,
  PasswordSchema,
  requestEmailChange,
  requestPasswordReset,
  resetPassword,
  verifyEmailToken,
} from '../emailAuth';
import { createGuest } from '../guests';
import { activeBan, nameProblem } from '../moderation';
import { reportError } from '../monitoring';
import { nameShape } from '../names';
import { disconnectSession } from '../notify';
import { guestsPaused } from '../settings';
import { count } from '../stats';
import { network, throttled, wideNetwork } from '../throttle';
import { getUser, getUserByLogin, nameTaken, usernameKey } from '../users';
import { confirmPassword, parse, requireAccount } from './common';

/** Signing up, in and out, playing as a guest, and the links emails carry (verify an address, reset a password). */
export const authRouter = Router();

const Credentials = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, 'Името трябва да е поне 3 символа.')
      .max(20, 'Името може да е най-много 20 символа.')
      .regex(/^[\p{L}\p{N}_.-]+$/u, 'Само букви, цифри, точка, тире и долна черта.'),
    password: PasswordSchema,
  })
  // The first thing anyone tries.
  .refine((c) => c.password.toLowerCase() !== c.username.toLowerCase(), {
    path: ['password'],
    message: 'Паролата не може да е същата като името.',
  });

export const Registration = Credentials.extend({ email: z.union([z.literal(''), EmailSchema]).optional() });

/** Login takes a username or a verified email. */
const Login = z.object({
  username: z.string().trim().min(1, 'Въведи име или имейл.').max(254),
  password: z.string().min(1, 'Въведи парола.').max(200),
});

/** An emailed link's token: a mail app that cuts the link short lands here. */
const BROKEN_LINK = 'Линкът е непълен или повреден. Отвори го отново направо от писмото.';
export const Token = z.string().min(10, BROKEN_LINK).max(200, BROKEN_LINK);

authRouter.post('/auth/register', async (req, res) => {
  // Generous per-network limit: a whole school class (or a mobile operator's shared address) may sign up from it.
  if (throttled(`register:${network(req.ip)}`, 60, 60 * 60_000)) {
    res.status(429).json({ error: 'Твърде много регистрации. Опитай по-късно.' });
    return;
  }
  const creds = parse(Registration, req, res);
  if (!creds) return;
  const problem = nameProblem(creds.username);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  const taken = nameTaken(creds.username);
  if (taken) {
    res.status(409).json({ error: taken });
    return;
  }
  const hash = await hashPassword(creds.password);
  // Someone may have taken it, or one that looks the same, while the password was hashing.
  const takenSince = nameTaken(creds.username);
  if (takenSince) {
    res.status(409).json({ error: takenSince });
    return;
  }
  // In development the very first account runs the place. In production nobody gets admin by signing up: moderators
  // are made with the admin command line (src/cli.ts), so no name can be claimed by someone faster.
  const firstUser = !config.production && one<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n === 0;
  let userId: number;
  try {
    const { lastInsertRowid } = run(
      `INSERT INTO users (username, username_key, username_shape, password_hash, created_at, is_admin)
       VALUES (?, ?, ?, ?, ?, ?)`,
      creds.username,
      usernameKey(creds.username),
      nameShape(creds.username),
      hash,
      Date.now(),
      firstUser ? 1 : 0,
    );
    userId = Number(lastInsertRowid);
  } catch (err) {
    // Someone took the name while the password was hashing (a double-tap on "sign up" is enough).
    if (!isUniqueViolation(err)) throw err;
    res.status(409).json({ error: 'Това име вече е заето.' });
    return;
  }
  if (creds.email) requestEmailChange(userId, creds.email, network(req.ip));
  count('signups');
  setSessionCookie(res, createSession(userId));
  setDeviceCookie(res, userId);
  res.status(201).json({ user: getMe(userId) });
});

authRouter.post('/auth/login', async (req, res) => {
  const creds = parse(Login, req, res);
  if (!creds) return;
  const tooMany = () => res.status(429).json({ error: 'Твърде много опити. Изчакай няколко минути.' });
  // Per IP across accounts (password spraying) first: names are the sender's to choose, so a network over its limit
  // adds no keys for new ones.
  if (throttled(`login-ip:${network(req.ip)}`, 100, 15 * 60_000)) return tooMany();
  const user = getUserByLogin(creds.username);
  // Then per IP and account, and per account across IPs (distributed guessing) — counted by the account itself, so its
  // name and its email don't each get an allowance. A device this account signed in from before has an allowance of
  // its own instead: guesses from everywhere else can't lock its owner out.
  const account = user ? `#${user.id}` : usernameKey(creds.username);
  const device = user ? knownDevice(req, user.id) : null;
  if (
    throttled(`login:${network(req.ip)}:${account}`) ||
    (device
      ? throttled(`login-device:${device}`, 30, 15 * 60_000)
      : throttled(`login-account:${account}`, 30, 15 * 60_000))
  ) {
    return tooMany();
  }
  // An unknown login still costs a password check, so timing doesn't reveal which usernames and emails exist.
  const valid = await verifyPassword(creds.password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!user || !valid) {
    res.status(401).json({ error: 'Грешно име или парола.' });
    return;
  }
  const ban = activeBan(user);
  if (ban) {
    res.status(403).json({ error: ban });
    return;
  }
  // A hash from before the current cost: redone now, while the password is at hand.
  if (needsRehash(user.password_hash)) {
    run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(creds.password), user.id);
  }
  setSessionCookie(res, createSession(user.id));
  setDeviceCookie(res, user.id);
  res.json({ user: getMe(user.id) });
});

/** Always answers the same way, so it can't be used to discover accounts or emails. */
authRouter.post('/auth/forgot', (req, res) => {
  const body = parse(z.object({ login: z.string().trim().min(1, 'Въведи име или имейл.').max(254) }), req, res);
  if (!body) return;
  if (
    throttled(`forgot-ip:${network(req.ip)}`, 5, 15 * 60_000) ||
    throttled(`forgot:${usernameKey(body.login)}`, 3, 60 * 60_000)
  ) {
    res.status(429).json({ error: 'Твърде много заявки. Опитай по-късно.' });
    return;
  }
  requestPasswordReset(body.login);
  res.json({ ok: true });
});

authRouter.post('/auth/reset', async (req, res) => {
  const body = parse(z.object({ token: Token, password: PasswordSchema }), req, res);
  if (!body) return;
  if (throttled(`reset:${network(req.ip)}`, 10, 15 * 60_000)) {
    res.status(429).json({ error: 'Твърде много опити. Опитай по-късно.' });
    return;
  }
  const result = await resetPassword(body.token, body.password);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  // A new password doesn't lift a ban.
  const ban = activeBan(getUser(result.userId)!);
  if (ban) {
    res.status(403).json({ error: ban });
    return;
  }
  setSessionCookie(res, createSession(result.userId));
  setDeviceCookie(res, result.userId);
  res.json({ user: getMe(result.userId) });
});

/** The token alone proves mailbox ownership, so this works signed out too. */
authRouter.post('/auth/verify-email', (req, res) => {
  // Links can't be guessed (32 random bytes), but there's no reason to let anyone try thousands.
  if (throttled(`verify:${network(req.ip)}`, 20, 15 * 60_000)) {
    res.status(429).json({ error: 'Твърде много опити. Опитай по-късно.' });
    return;
  }
  const body = parse(z.object({ token: Token }), req, res);
  if (!body) return;
  const result = verifyEmailToken(body.token);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

/** "Играй като гост": a real account without a name or password yet, so a first game is one tap away. */
authRouter.post('/auth/guest', (req, res) => {
  const current = userIdFromRequest(req, res);
  if (current) {
    res.json({ user: getMe(current) });
    return;
  }
  if (guestsPaused()) {
    res.status(503).json({ error: 'В момента не приемаме нови гости. Направи си профил или опитай по-късно.' });
    return;
  }
  // A mobile operator puts thousands of phones behind one address, and a challenge link shared in a group chat sends
  // them in together: the caps per address and per wider network are high. No cap is shared by everyone (a flood from
  // many networks would turn every newcomer away): an unusual hour is reported, and `cli guests off` is the brake.
  if (
    throttled(`guest:${network(req.ip)}`, 300, 60 * 60_000) ||
    throttled(`guest-wide:${wideNetwork(req.ip)}`, 1_000, 60 * 60_000)
  ) {
    res.status(429).json({ error: 'Твърде много нови гости от тази мрежа. Опитай по-късно или си направи профил.' });
    return;
  }
  if (throttled('guest-all', 5_000, 60 * 60_000) && !throttled('guest-all-reported', 1, 60 * 60_000))
    void reportError(new Error('Over 5,000 new guests in an hour'), 'guest flood');
  const userId = createGuest();
  count('guests');
  setSessionCookie(res, createSession(userId, false));
  res.status(201).json({ user: getMe(userId) });
});

authRouter.post('/auth/logout', (req, res) => {
  const token = sessionTokenFromCookieHeader(req.headers.cookie);
  if (token) {
    destroySession(token);
    disconnectSession(hashToken(token)); // the socket of every tab on this session too
  }
  setSessionCookie(res, null);
  res.json({ ok: true });
});

/** The password, given again for what needs a recent one (requireRecentPassword). */
authRouter.post('/auth/confirm', requireAuth, requireAccount, async (req, res) => {
  const body = parse(z.object({ password: z.string().min(1, 'Въведи паролата си.').max(200) }), req, res);
  if (!body || !(await confirmPassword(res, body.password))) return;
  confirmSession(sessionTokenFromCookieHeader(req.headers.cookie)!);
  res.json({ ok: true });
});
