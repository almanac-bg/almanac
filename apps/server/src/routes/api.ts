import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  achievementById,
  type CategoryId,
  type DuelRecord,
  isQueueMode,
  type LeaderboardBoard,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type ModeId,
  type ProfileStats,
  type QueueModeId,
  seasonEndsAt,
  seasonKey,
  seasonName,
} from '@quiz/shared';
import express, { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { deleteAccount, exportAccount, getMe, settleAccount, updateLoadout } from '../account';
import { achievementProgress } from '../achievements';
import { factCount, factsInAll } from '../almanac';
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
import { challengeInfo, challengePreview, duelRecord, myChallenges, myDuels } from '../challenges';
import { config } from '../config';
import { dailyInfo, dailyLink, dailyPreview, joinBoardAfterSave, liveDailyStreak } from '../daily';
import { all, isUniqueViolation, one, run, tx } from '../db';
import {
  changePassword,
  EmailSchema,
  PasswordSchema,
  removeEmail,
  requestEmailChange,
  requestPasswordReset,
  resetPassword,
  verifyEmailToken,
} from '../emailAuth';
import { emailEventsSecretMatches, handleEmailEvent } from '../emailEvents';
import { eveningInfo } from '../evening';
import {
  acceptFriend,
  blockedPlayers,
  blockPlayer,
  type FriendResult,
  friendship,
  listFriends,
  removeFriend,
  requestFriend,
  unblockPlayer,
} from '../friends';
import { createGuest } from '../guests';
import { activeBan, fileReport, nameProblem } from '../moderation';
import { reportError } from '../monitoring';
import { nameShape } from '../names';
import { listNotifications, markNotificationsRead } from '../notifications';
import { disconnectSession, sendFriendsUpdate } from '../notify';
import { PrefsSchema, push, pushEnabled, SubscriptionSchema, setPushPrefs, subscribe, unsubscribe } from '../push';
import { reportQuestion } from '../questionReports';
import { getRatings, markSeasonRewardsSeen, seasonHistory, seasonInfo } from '../seasons';
import { guestsPaused } from '../settings';
import { siteInfo } from '../site';
import { count } from '../stats';
import { DraftSchema, editSubmission, mySubmissions, submitQuestion, withdrawSubmission } from '../submissions';
import { network, throttled, wideNetwork } from '../throttle';
import {
  emailKey,
  getUser,
  getUserByLogin,
  getUserByName,
  NOT_BANNED,
  nameTaken,
  toPublicUser,
  type UserRow,
  usernameKey,
} from '../users';
import { adminRouter } from './admin';
import { idParam, parse, requireAccount } from './common';
import { progress } from './progress';
import { setsRouter } from './sets';

export const api = Router();
api.use(progress);
api.use(adminRouter);
api.use(setsRouter);

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

const Registration = Credentials.extend({ email: z.union([z.literal(''), EmailSchema]).optional() });

/** Login takes a username or a verified email. */
const Login = z.object({
  username: z.string().trim().min(1, 'Въведи име или имейл.').max(254),
  password: z.string().min(1, 'Въведи парола.').max(200),
});

/** An emailed link's token: a mail app that cuts the link short lands here. */
const BROKEN_LINK = 'Линкът е непълен или повреден. Отвори го отново направо от писмото.';
const Token = z.string().min(10, BROKEN_LINK).max(200, BROKEN_LINK);

function sameSecret(a: string, b: string) {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
}

// ─── Auth ────────────────────────────────────────────────────────────────────

api.post('/auth/register', async (req, res) => {
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

api.post('/auth/login', async (req, res) => {
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
api.post('/auth/forgot', (req, res) => {
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

api.post('/auth/reset', async (req, res) => {
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
api.post('/auth/verify-email', (req, res) => {
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
api.post('/auth/guest', (req, res) => {
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

api.post('/auth/logout', (req, res) => {
  const token = sessionTokenFromCookieHeader(req.headers.cookie);
  if (token) {
    destroySession(token);
    disconnectSession(hashToken(token)); // the socket of every tab on this session too
  }
  setSessionCookie(res, null);
  res.json({ ok: true });
});

/** The password, given again for what needs a recent one (requireRecentPassword). */
api.post('/auth/confirm', requireAuth, requireAccount, async (req, res) => {
  const body = parse(z.object({ password: z.string().min(1, 'Въведи паролата си.').max(200) }), req, res);
  if (!body || !(await confirmPassword(res, body.password))) return;
  confirmSession(sessionTokenFromCookieHeader(req.headers.cookie)!);
  res.json({ ok: true });
});

// ─── Me ──────────────────────────────────────────────────────────────────────

/** For the privacy policy, terms and footer (works signed out). */
api.get('/legal', (_req, res) => {
  res.json(siteInfo);
});

/** Delivery reports from the mail provider (see emailEvents.ts); SNS posts them as text/plain. */
api.post('/email-events/:secret', express.text({ type: () => true, limit: '64kb' }), (req, res, next) => {
  if (!emailEventsSecretMatches(req.params.secret)) return next();
  handleEmailEvent(req.body).then(
    () => res.status(204).end(),
    (err) => {
      void reportError(err, 'email events');
      res.status(204).end();
    },
  );
});

/** Signed-out visitors get `{ user: null }` rather than a 401, so the first page load stays quiet. */
api.get('/me', (req, res) => {
  const userId = userIdFromRequest(req, res);
  res.json({ user: userId ? getMe(userId) : null });
});

api.patch('/me/loadout', requireAuth, (req, res) => {
  const body = parse(
    z.object({ avatar: z.string().optional(), frame: z.string().optional(), title: z.string().optional() }),
    req,
    res,
  );
  if (!body) return;
  const result = updateLoadout(res.locals.userId, body);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ user: getMe(res.locals.userId) });
});

/** Changing or removing the email needs the password: whoever controls the email can reset the password. */
async function confirmPassword(res: Response, password: string): Promise<boolean> {
  if (throttled(`confirm-password:${res.locals.userId}`, 10, 15 * 60_000)) {
    res.status(429).json({ error: 'Твърде много опити. Изчакай няколко минути.' });
    return false;
  }
  if (!(await verifyPassword(password, getUser(res.locals.userId)!.password_hash))) {
    res.status(400).json({ error: 'Грешна парола.' });
    return false;
  }
  return true;
}

api.post('/account/email', requireAuth, requireAccount, async (req, res) => {
  const body = parse(z.object({ email: z.string().max(254), password: z.string().max(200).optional() }), req, res);
  if (!body) return;
  // (How often one address gets mail is limited where every verification mail is sent: requestEmailChange.)
  if (throttled(`email:${res.locals.userId}`, 5, 60 * 60_000)) {
    res.status(429).json({ error: 'Твърде много опити. Опитай по-късно.' });
    return;
  }
  // Re-sending the link to the address already waiting is harmless; a new address needs the password.
  const resend = getUser(res.locals.userId)!.pending_email;
  if (!(resend && emailKey(resend) === emailKey(body.email))) {
    if (!body.password) {
      res.status(400).json({ error: 'Въведи паролата си, за да смениш имейла.' });
      return;
    }
    if (!(await confirmPassword(res, body.password))) return;
  }
  const result = requestEmailChange(res.locals.userId, body.email, network(req.ip));
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ user: getMe(res.locals.userId) });
});

api.delete('/account/email', requireAuth, requireAccount, async (req, res) => {
  const body = parse(z.object({ password: z.string().min(1, 'Въведи паролата си.').max(200) }), req, res);
  if (!body || !(await confirmPassword(res, body.password))) return;
  removeEmail(res.locals.userId);
  res.json({ user: getMe(res.locals.userId) });
});

api.post('/account/password', requireAuth, requireAccount, async (req, res) => {
  const body = parse(
    z.object({ current: z.string().min(1, 'Въведи текущата парола.').max(200), next: PasswordSchema }),
    req,
    res,
  );
  if (!body) return;
  if (throttled(`password:${res.locals.userId}`, 10, 15 * 60_000)) {
    res.status(429).json({ error: 'Твърде много опити. Изчакай няколко минути.' });
    return;
  }
  const result = await changePassword(
    res.locals.userId,
    body.current,
    body.next,
    sessionTokenFromCookieHeader(req.headers.cookie),
  );
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

/** A guest picks a name and password (and maybe an email): the same account, with everything played so far. */
api.post('/account/claim', requireAuth, async (req, res) => {
  const me = getUser(res.locals.userId)!;
  if (!me.is_guest) {
    res.status(400).json({ error: 'Профилът ти вече има име и парола.' });
    return;
  }
  if (throttled(`claim:${me.id}`, 10, 15 * 60_000)) {
    res.status(429).json({ error: 'Твърде много опити. Изчакай няколко минути.' });
    return;
  }
  const creds = parse(Registration, req, res);
  if (!creds) return;
  const problem = nameProblem(creds.username);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  const taken = nameTaken(creds.username, me.id);
  if (taken) {
    res.status(409).json({ error: taken });
    return;
  }
  const hash = await hashPassword(creds.password);
  // Someone may have taken it, or one that looks the same, while the password was hashing.
  const takenSince = nameTaken(creds.username, me.id);
  if (takenSince) {
    res.status(409).json({ error: takenSince });
    return;
  }
  try {
    tx(() => {
      run(
        `UPDATE users SET username = ?, username_key = ?, username_shape = ?, password_hash = ?, is_guest = 0
         WHERE id = ? AND is_guest = 1`,
        creds.username,
        usernameKey(creds.username),
        nameShape(creds.username),
        hash,
        me.id,
      );
      // Matches already played show the new name too.
      run('UPDATE match_players SET name = ? WHERE user_id = ?', creds.username, me.id);
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    res.status(409).json({ error: 'Това име вече е заето.' });
    return;
  }
  // The account gets a session of its own: whoever else held the guest's cookie (copied off this device, or planted
  // in it before the name and password were set) is left holding nothing. Their open sockets go a few seconds later,
  // once this answer has given the player's tabs the new cookie to come back with.
  const guestSession = sessionTokenFromCookieHeader(req.headers.cookie);
  run('DELETE FROM sessions WHERE user_id = ?', me.id);
  setSessionCookie(res, createSession(me.id));
  if (guestSession) setTimeout(() => disconnectSession(hashToken(guestSession)), 5_000).unref();
  if (creds.email) requestEmailChange(me.id, creds.email, network(req.ip));
  // Made before today, the account is on the day's board now, with today's run if it played one.
  joinBoardAfterSave(me.id);
  count('claims');
  setDeviceCookie(res, me.id);
  res.json({ user: getMe(me.id) });
});

/** The evening "your streak is about to break" email (needs a verified address). */
api.post('/account/reminders', requireAuth, requireAccount, (req, res) => {
  const body = parse(z.object({ on: z.boolean() }), req, res);
  if (!body) return;
  if (body.on && !getUser(res.locals.userId)!.email) {
    res.status(400).json({ error: 'Първо добави и потвърди имейл.' });
    return;
  }
  run(
    'UPDATE users SET streak_reminders = ?, reminder_key = COALESCE(reminder_key, ?) WHERE id = ?',
    body.on ? 1 : 0,
    randomBytes(16).toString('base64url'),
    res.locals.userId,
  );
  res.json({ user: getMe(res.locals.userId) });
});

/** The „X те изпревари на линка ти“ email: opt-in, like the streak reminder (and stopped by the same link). */
api.post('/account/beaten-mails', requireAuth, requireAccount, (req, res) => {
  const body = parse(z.object({ on: z.boolean() }), req, res);
  if (!body) return;
  if (body.on && !getUser(res.locals.userId)!.email) {
    res.status(400).json({ error: 'Първо добави и потвърди имейл.' });
    return;
  }
  run(
    'UPDATE users SET beaten_mails = ?, reminder_key = COALESCE(reminder_key, ?) WHERE id = ?',
    body.on ? 1 : 0,
    randomBytes(16).toString('base64url'),
    res.locals.userId,
  );
  res.json({ user: getMe(res.locals.userId) });
});

/** Others may play against this player's recorded matches (a recording plays when nobody's there for a Дуел). */
api.post('/account/share-runs', requireAuth, requireAccount, (req, res) => {
  const body = parse(z.object({ on: z.boolean() }), req, res);
  if (!body) return;
  run('UPDATE users SET share_runs = ? WHERE id = ?', body.on ? 1 : 0, res.locals.userId);
  res.json({ user: getMe(res.locals.userId) });
});

/** Your friend duels: whose turn it is in the open ones, and how the week's ended. */
api.get('/duels', requireAuth, (_req, res) => {
  res.json({ duels: myDuels(res.locals.userId) });
});

/** The unsubscribe link in reminder emails (and the mail apps' one-click unsubscribe): no sign-in needed. */
api.post('/reminders/off', (req, res) => {
  const { u, k } = req.query;
  const user = typeof u === 'string' && /^\d{1,12}$/.test(u) ? getUser(Number(u)) : undefined;
  if (!user?.reminder_key || typeof k !== 'string' || !sameSecret(user.reminder_key, k)) {
    res.status(400).json({ error: 'Линкът не е валиден.' });
    return;
  }
  // Every optional mail: the streak reminder and the beaten-on-your-link note.
  run('UPDATE users SET streak_reminders = 0, beaten_mails = 0 WHERE id = ?', user.id);
  res.json({ ok: true });
});

api.get('/account/export', requireAuth, (_req, res) => {
  // Everything ever played, built on the thread the matches run on: a few a while is plenty.
  if (throttled(`export:${res.locals.userId}`, 3, 10 * 60_000)) {
    res.status(429).json({ error: 'Вече изтегли данните си. Опитай пак след няколко минути.' });
    return;
  }
  res.setHeader('content-disposition', 'attachment; filename="almanac-data.json"');
  res.type('application/json').send(JSON.stringify(exportAccount(res.locals.userId), null, 2));
});

api.post('/account/delete', requireAuth, async (req, res) => {
  // Guests have no password (deleteAccount asks everyone else for theirs).
  const body = parse(z.object({ password: z.string().max(200).default('') }), req, res);
  if (!body) return;
  if (throttled(`delete:${res.locals.userId}`, 5, 15 * 60_000)) {
    res.status(429).json({ error: 'Твърде много опити. Изчакай няколко минути.' });
    return;
  }
  const result = await deleteAccount(res.locals.userId, body.password);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  setSessionCookie(res, null);
  res.json({ ok: true });
});

/** Crashes in players' browsers, into the server log: with Sentry off, or before its SDK has loaded in the page. */
api.post('/client-errors', (req, res) => {
  const body = z
    .object({
      message: z.string().max(500),
      stack: z.string().max(4000).optional(),
      url: z.string().max(300).optional(),
      kind: z.enum(['render', 'error', 'rejection']),
    })
    .safeParse(req.body);
  if (body.success && !throttled(`client-error:${network(req.ip)}`, 20, 10 * 60_000)) {
    // Untrusted text: one line for the message, an indented block for the stack, so it can't forge log entries.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: it strips control characters on purpose (log forging)
    const line = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ');
    const { kind, message, url, stack } = body.data;
    // Only the path, and not whose profile or which room: the log keeps no names or codes.
    const where = (url ?? '?').split(/[?#]/)[0].replace(/\/(profile|join)\/[^/]+/g, '/$1/*');
    const trace = stack
      ? `\n${stack
          .split('\n')
          .map((l) => `    | ${line(l)}`)
          .join('\n')}`
      : '';
    console.error(`🧯 Browser ${kind} at ${line(where)}: ${line(message)}${trace}`);
  }
  res.status(204).end();
});

api.post('/reports', requireAuth, requireAccount, (req, res) => {
  const body = parse(
    z.object({
      username: z.string().trim().min(1).max(40),
      reason: z.string(),
      details: z.string().max(500).default(''),
    }),
    req,
    res,
  );
  if (!body) return;
  const result = fileReport(res.locals.userId, body.username, body.reason, body.details);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

api.get('/notifications', requireAuth, (_req, res) => {
  res.json({ notifications: listNotifications(res.locals.userId) });
});

api.post('/notifications/read', requireAuth, (_req, res) => {
  markNotificationsRead(res.locals.userId);
  res.json({ ok: true });
});

api.get('/achievements', requireAuth, (_req, res) => {
  res.json({ achievements: achievementProgress(res.locals.userId) });
});

// ─── Challenge links ─────────────────────────────────────────────────────────

const challengeId = (req: Request) => String(req.params.id).slice(0, 16);

api.get('/challenges', requireAuth, (_req, res) => {
  res.json({ challenges: myChallenges(res.locals.userId) });
});

/** Signed out too: the link's landing page shows who's challenging and the score to beat. */
api.get('/challenges/:id/preview', (req, res) => {
  if (throttled(`challenge-preview:${network(req.ip)}`, 120, 60_000)) {
    res.status(429).json({ error: 'Твърде много заявки.' });
    return;
  }
  const preview = challengePreview(challengeId(req));
  if (preview) count('link_opens:challenge');
  if (!preview) {
    res.status(404).json({ error: 'Няма такова предизвикателство.' });
    return;
  }
  res.json(preview);
});

api.get('/challenges/:id', requireAuth, (req, res) => {
  const info = challengeInfo(challengeId(req), res.locals.userId);
  if (!info) {
    res.status(404).json({ error: 'Няма такова предизвикателство.' });
    return;
  }
  res.json(info);
});

// ─── Daily & seasons ─────────────────────────────────────────────────────────

api.get('/daily', requireAuth, (_req, res) => {
  res.json(dailyInfo(res.locals.userId));
});

/** A daily link as anyone sees it, signed in or not (`code` optional: /daily itself). */
api.get('/daily/preview', (req, res) => {
  if (throttled(`daily-preview:${network(req.ip)}`, 120, 60_000)) {
    res.status(429).json({ error: 'Твърде много заявки.' });
    return;
  }
  const code = typeof req.query.code === 'string' ? req.query.code.slice(0, 16) : null;
  const preview = dailyPreview(code);
  if (code && preview.sharer) count('link_opens:daily');
  res.json(preview);
});

/** The player's link to today's questions, to send around; made once they've played today. */
api.post('/daily/link', requireAuth, (_req, res) => {
  const code = dailyLink(res.locals.userId);
  if (!code) {
    res.status(409).json({ error: 'Изиграй днешните въпроси, за да ги пратиш на някого.' });
    return;
  }
  res.json({ code });
});

/** Tonight's evening Роял (whether you're in its lobby) and the last one's top. */
api.get('/evening', requireAuth, (_req, res) => {
  res.json(eveningInfo(res.locals.userId));
});

api.get('/season', requireAuth, (_req, res) => {
  res.json(seasonInfo(res.locals.userId));
});

api.post('/season/seen', requireAuth, (_req, res) => {
  markSeasonRewardsSeen(res.locals.userId);
  res.json({ ok: true });
});

// ─── Friends ─────────────────────────────────────────────────────────────────

function friendReply(res: Response, me: number, result: FriendResult) {
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  // Both sides refresh (the actor's other tabs and nav badge too).
  sendFriendsUpdate(result.otherId);
  sendFriendsUpdate(me);
  if (result.accepted) {
    settleAccount(me);
    settleAccount(result.otherId);
  }
  res.json(listFriends(me));
}

api.get('/friends', requireAuth, (_req, res) => {
  res.json(listFriends(res.locals.userId));
});

api.post('/friends', requireAuth, requireAccount, (req, res) => {
  const body = parse(z.object({ username: z.string().trim().min(1, 'Въведи име.').max(40) }), req, res);
  if (!body) return;
  // Per sender, and per pair (removing and re-requesting the same player can't become a notification loop).
  const pair = `${res.locals.userId}:${usernameKey(body.username)}`;
  if (
    throttled(`friend-request:${res.locals.userId}`, 30, 60 * 60_000) ||
    throttled(`friend-pair:${pair}`, 3, 24 * 60 * 60_000)
  ) {
    res.status(429).json({ error: 'Твърде много покани. Опитай по-късно.' });
    return;
  }
  friendReply(res, res.locals.userId, requestFriend(res.locals.userId, body.username));
});

api.post('/friends/:id/accept', requireAuth, requireAccount, (req, res) => {
  friendReply(res, res.locals.userId, acceptFriend(res.locals.userId, idParam(req)));
});

api.delete('/friends/:id', requireAuth, (req, res) => {
  const other = idParam(req);
  if (removeFriend(res.locals.userId, other)) {
    sendFriendsUpdate(other);
    sendFriendsUpdate(res.locals.userId);
  }
  res.json(listFriends(res.locals.userId));
});

// ─── Web push ────────────────────────────────────────────────────────────────

/** The key a device subscribes with (null: this site has no push set up). */
api.get('/push/key', (_req, res) => {
  res.json({ key: config.vapid?.publicKey ?? null });
});

/** This device gets pushes; the first one confirms it works. */
api.post('/push/subscribe', requireAuth, requireAccount, (req, res) => {
  if (!pushEnabled()) {
    res.status(503).json({ error: 'Известията не са включени на този сайт.' });
    return;
  }
  const sub = parse(SubscriptionSchema, req, res);
  if (!sub) return;
  if (throttled(`push-subscribe:${res.locals.userId}`, 20, 24 * 60 * 60_000)) {
    res.status(429).json({ error: 'Твърде много опити. Опитай утре.' });
    return;
  }
  subscribe(res.locals.userId, sub);
  push(res.locals.userId, 'hello', {
    title: 'Известията работят ✓',
    body: 'Ще идват само избраните в Настройки — най-много две на ден, нищо нощем.',
    url: '/settings',
  });
  res.json({ user: getMe(res.locals.userId) });
});

api.post('/push/unsubscribe', requireAuth, (req, res) => {
  const body = parse(z.object({ endpoint: z.string().max(1000) }), req, res);
  if (!body) return;
  unsubscribe(res.locals.userId, body.endpoint);
  res.json({ ok: true });
});

api.post('/push/prefs', requireAuth, requireAccount, (req, res) => {
  const prefs = parse(PrefsSchema, req, res);
  if (!prefs) return;
  setPushPrefs(res.locals.userId, prefs);
  res.json({ user: getMe(res.locals.userId) });
});

/** Players this one blocked (Settings), and blocking or unblocking one (from a request, a profile, the list). */
api.get('/blocks', requireAuth, requireAccount, (_req, res) => {
  res.json({ players: blockedPlayers(res.locals.userId) });
});

api.post('/blocks/:id', requireAuth, requireAccount, (req, res) => {
  const other = idParam(req);
  const done = blockPlayer(res.locals.userId, other);
  if (!done.ok) {
    res.status(400).json({ error: done.error });
    return;
  }
  sendFriendsUpdate(other);
  sendFriendsUpdate(res.locals.userId);
  res.json({ players: blockedPlayers(res.locals.userId) });
});

api.delete('/blocks/:id', requireAuth, requireAccount, (req, res) => {
  unblockPlayer(res.locals.userId, idParam(req));
  res.json({ players: blockedPlayers(res.locals.userId) });
});

// ─── Community questions ─────────────────────────────────────────────────────

api.get('/submissions/mine', requireAuth, (_req, res) => {
  res.json({ submissions: mySubmissions(res.locals.userId) });
});

api.post('/submissions', requireAuth, requireAccount, (req, res) => {
  const draft = parse(DraftSchema, req, res);
  if (!draft) return;
  const result = submitQuestion(res.locals.userId, draft);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.status(201).json({ submission: result.submission });
});

/** The author changes a question while it waits. */
api.put('/submissions/:id', requireAuth, requireAccount, (req, res) => {
  const draft = parse(DraftSchema, req, res);
  if (!draft) return;
  const result = editSubmission(res.locals.userId, idParam(req), draft);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ submission: result.submission });
});

/** …or takes it back. */
api.delete('/submissions/:id', requireAuth, requireAccount, (req, res) => {
  if (!withdrawSubmission(res.locals.userId, idParam(req))) {
    res.status(404).json({ error: 'Няма чакащо предложение с този номер.' });
    return;
  }
  res.json({ ok: true });
});

api.post('/questions/:id/report', requireAuth, requireAccount, (req, res) => {
  const body = parse(z.object({ reason: z.string(), details: z.string().max(500).default('') }), req, res);
  if (!body) return;
  if (throttled(`question-report:${res.locals.userId}`, 30, 60 * 60_000)) {
    res.status(429).json({ error: 'Твърде много сигнали. Опитай по-късно.' });
    return;
  }
  const result = reportQuestion(res.locals.userId, String(req.params.id), body.reason, body.details);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

// ─── Profiles & leaderboards ─────────────────────────────────────────────────

api.get('/profile/:username', requireAuth, (req, res) => {
  const user = getUserByName(String(req.params.username));
  if (!user) {
    res.status(404).json({ error: 'Няма такъв играч.' });
    return;
  }
  res.json(profileStats(user, res.locals.userId));
});

api.get('/leaderboard/:board', requireAuth, (req, res) => {
  const board = String(req.params.board) as LeaderboardBoard;
  if (board !== 'level' && board !== 'daily' && !isQueueMode(board)) {
    res.status(404).json({ error: 'Няма такава класация.' });
    return;
  }
  res.json(leaderboard(board, res.locals.userId));
});

const someDuels = (r: DuelRecord) => (r.wins + r.losses + r.draws ? r : null);

function profileStats(u: UserRow, viewerId: number): ProfileStats {
  const ratings = getRatings(u.id);
  const modes = all<{ mode: ModeId; games: number; wins: number; avg_placement: number | null }>(
    `SELECT m.mode, COUNT(*) AS games,
       SUM(CASE WHEN mp.placement = 1 AND m.player_count > 1 AND mp.left_match = 0 THEN 1 ELSE 0 END) AS wins,
       AVG(CASE WHEN m.player_count > 1 THEN mp.placement END) AS avg_placement
     FROM match_players mp JOIN matches m ON m.id = mp.match_id
     WHERE mp.user_id = ? GROUP BY m.mode`,
    u.id,
  );
  const recent = all<{
    id: string;
    mode: ModeId;
    ended_at: number;
    player_count: number;
    question_count: number;
    placement: number;
    score: number;
    correct: number;
    xp_gained: number;
    rating_delta: number | null;
  }>(
    `SELECT m.id, m.mode, m.ended_at, m.player_count, m.question_count, mp.placement, mp.score, mp.correct,
       mp.xp_gained, mp.rating_delta
     FROM match_players mp JOIN matches m ON m.id = mp.match_id
     WHERE mp.user_id = ? ORDER BY m.ended_at DESC LIMIT 20`,
    u.id,
  );
  return {
    user: { ...toPublicUser(u), createdAt: u.created_at },
    friendship: friendship(viewerId, u.id),
    blocked: !!one('SELECT 1 AS x FROM blocks WHERE user_id = ? AND blocked_id = ?', viewerId, u.id),
    duels: viewerId === u.id ? null : someDuels(duelRecord(viewerId, u.id)),
    overview: {
      gamesPlayed: u.games_played,
      multiplayerGames: u.mp_games,
      wins: u.wins,
      questionsAnswered: u.questions_answered,
      correctAnswers: u.correct_answers,
      bestStreak: u.best_streak,
      fastestCorrectMs: u.fastest_correct_ms,
      avgCorrectMs: u.correct_answers > 0 ? Math.round(u.total_correct_ms / u.correct_answers) : null,
      bestSoloScore: u.best_solo_score,
      powerupsUsed: u.powerups_used,
      dailyStreak: liveDailyStreak(u),
      bestDailyStreak: u.best_daily_streak,
      questionsApproved: one<{ n: number }>('SELECT COUNT(*) AS n FROM questions WHERE author_id = ?', u.id)!.n,
    },
    modes: modes.map((m) => ({
      mode: m.mode,
      games: m.games,
      wins: m.wins,
      avgPlacement: m.avg_placement === null ? null : Math.round(m.avg_placement * 10) / 10,
      rating: isQueueMode(m.mode) ? (ratings[m.mode] ?? null) : null,
    })),
    categories: all<{ category: CategoryId; answered: number; correct: number; tier: number | null }>(
      `SELECT c.category, c.answered, c.correct, m.tier FROM category_stats c
       LEFT JOIN mastery m ON m.user_id = c.user_id AND m.category = c.category WHERE c.user_id = ?`,
      u.id,
    ).map((c) => ({ ...c })),
    almanac: { facts: factCount(u.id), total: factsInAll() },
    recent: recent.map((r) => ({
      matchId: r.id,
      mode: r.mode,
      endedAt: r.ended_at,
      placement: r.placement,
      players: r.player_count,
      score: r.score,
      correct: r.correct,
      questions: r.question_count,
      xp: r.xp_gained,
      ratingDelta: r.rating_delta === null ? null : Math.round(r.rating_delta),
    })),
    achievements: all<{ achievement_id: string; unlocked_at: number }>(
      'SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ? ORDER BY unlocked_at DESC',
      u.id,
    )
      // One that was retired since (it went with "Леден удар") stays in the table, not on the profile.
      .filter((a) => achievementById(a.achievement_id))
      .map((a) => ({ id: a.achievement_id, unlockedAt: a.unlocked_at })),
    seasons: seasonHistory(u.id).map(({ season, tier }) => ({ season, tier })),
  };
}

type BoardRow = UserRow & { rating?: number; games?: number; wins?: number };

function leaderboard(board: LeaderboardBoard, userId: number): LeaderboardResponse {
  const LIMIT = 50;
  const toEntry = (row: BoardRow, rank: number): LeaderboardEntry => ({
    rank,
    user: toPublicUser(row),
    value: board === 'level' ? row.xp : Math.round(row.rating!),
    games: row.games,
    wins: row.wins,
  });

  if (board === 'daily') {
    const info = dailyInfo(userId);
    const me = getUser(userId)!;
    return {
      board,
      entries: info.entries,
      // A guest's run had questions of its own: no place on this board.
      me:
        info.played && info.played.rank !== null
          ? { rank: info.played.rank, user: toPublicUser(me), value: info.played.score, correct: info.played.correct }
          : null,
      season: null,
      friends: info.friends,
    };
  }

  if (board === 'level') {
    // Guests play but aren't listed (they can be made by the dozen); they still see where they'd stand.
    const rows = all<BoardRow>(
      `SELECT * FROM users u WHERE u.is_guest = 0 AND ${NOT_BANNED} ORDER BY u.xp DESC, u.id ASC LIMIT ?`,
      LIMIT,
    );
    const me = getUser(userId)!;
    const rank = one<{ n: number }>(
      `SELECT COUNT(*) + 1 AS n FROM users u WHERE u.is_guest = 0 AND ${NOT_BANNED} AND u.xp > ?`,
      me.xp,
    )!.n;
    return { board, entries: rows.map((r, i) => toEntry(r, i + 1)), me: toEntry(me, rank), season: null };
  }

  const season = seasonKey();
  const mode: QueueModeId = board;
  const rows = all<BoardRow>(
    `SELECT u.*, r.rating, r.games, r.wins FROM season_ratings r JOIN users u ON u.id = r.user_id
     WHERE r.season = ? AND r.mode = ? AND r.games > 0 AND u.is_guest = 0 AND ${NOT_BANNED}
     ORDER BY r.rating DESC, u.id ASC LIMIT ?`,
    season,
    mode,
    LIMIT,
  );
  const mine = one<BoardRow>(
    `SELECT u.*, r.rating, r.games, r.wins FROM season_ratings r JOIN users u ON u.id = r.user_id
     WHERE r.season = ? AND r.mode = ? AND u.id = ?`,
    season,
    mode,
    userId,
  );
  const rank = mine
    ? one<{ n: number }>(
        `SELECT COUNT(*) + 1 AS n FROM season_ratings r JOIN users u ON u.id = r.user_id
         WHERE r.season = ? AND r.mode = ? AND r.games > 0 AND u.is_guest = 0 AND ${NOT_BANNED} AND r.rating > ?`,
        season,
        mode,
        mine.rating!,
      )!.n
    : 0;
  return {
    board,
    entries: rows.map((r, i) => toEntry(r, i + 1)),
    me: mine ? toEntry(mine, rank) : null,
    season: { id: season, name: seasonName(season), endsAt: seasonEndsAt(season) },
  };
}
