import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { deleteAccount, exportAccount, getMe, updateLoadout } from '../account';
import { achievementProgress } from '../achievements';
import {
  createSession,
  hashPassword,
  hashToken,
  requireAuth,
  sessionTokenFromCookieHeader,
  setDeviceCookie,
  setSessionCookie,
  userIdFromRequest,
} from '../auth';
import { myDuels } from '../challenges';
import { config } from '../config';
import { joinBoardAfterSave } from '../daily';
import { isUniqueViolation, run, tx } from '../db';
import { changePassword, PasswordSchema, removeEmail, requestEmailChange } from '../emailAuth';
import { nameProblem } from '../moderation';
import { nameShape } from '../names';
import { listNotifications, markNotificationsRead } from '../notifications';
import { disconnectSession } from '../notify';
import { PrefsSchema, push, pushEnabled, SubscriptionSchema, setPushPrefs, subscribe, unsubscribe } from '../push';
import { count } from '../stats';
import { network, throttled } from '../throttle';
import { emailKey, getUser, nameTaken, usernameKey } from '../users';
import { Registration } from './auth';
import { confirmPassword, parse, requireAccount } from './common';

/**
 * The signed-in player's own account: /me and what they wear, email and password, reminders and web push, their data
 * and deleting it, notifications and achievements.
 */
export const accountRouter = Router();

function sameSecret(a: string, b: string) {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Signed-out visitors get `{ user: null }` rather than a 401, so the first page load stays quiet. */
accountRouter.get('/me', (req, res) => {
  const userId = userIdFromRequest(req, res);
  res.json({ user: userId ? getMe(userId) : null });
});

accountRouter.patch('/me/loadout', requireAuth, (req, res) => {
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

accountRouter.post('/account/email', requireAuth, requireAccount, async (req, res) => {
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

accountRouter.delete('/account/email', requireAuth, requireAccount, async (req, res) => {
  const body = parse(z.object({ password: z.string().min(1, 'Въведи паролата си.').max(200) }), req, res);
  if (!body || !(await confirmPassword(res, body.password))) return;
  removeEmail(res.locals.userId);
  res.json({ user: getMe(res.locals.userId) });
});

accountRouter.post('/account/password', requireAuth, requireAccount, async (req, res) => {
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
accountRouter.post('/account/claim', requireAuth, async (req, res) => {
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
        `UPDATE users SET username = ?, username_key = ?, username_shape = ?, password_hash = ?, is_guest = 0,
         room_guest_seen_at = NULL WHERE id = ? AND is_guest = 1`,
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
accountRouter.post('/account/reminders', requireAuth, requireAccount, (req, res) => {
  const body = parse(z.object({ on: z.boolean() }), req, res);
  if (!body) return;
  if (body.on && !getUser(res.locals.userId)!.email) {
    res.status(400).json({ error: 'Първо добави и потвърди имейл.' });
    return;
  }
  run(
    // When it was turned on: consent that can be shown (GDPR Art. 7(1)).
    `UPDATE users SET streak_reminders = ?, reminder_key = COALESCE(reminder_key, ?),
     reminders_on_at = CASE WHEN ? THEN ? ELSE NULL END WHERE id = ?`,
    body.on ? 1 : 0,
    randomBytes(16).toString('base64url'),
    body.on ? 1 : 0,
    Date.now(),
    res.locals.userId,
  );
  res.json({ user: getMe(res.locals.userId) });
});

/** The „X те изпревари на линка ти“ email: opt-in, like the streak reminder (and stopped by the same link). */
accountRouter.post('/account/beaten-mails', requireAuth, requireAccount, (req, res) => {
  const body = parse(z.object({ on: z.boolean() }), req, res);
  if (!body) return;
  if (body.on && !getUser(res.locals.userId)!.email) {
    res.status(400).json({ error: 'Първо добави и потвърди имейл.' });
    return;
  }
  run(
    `UPDATE users SET beaten_mails = ?, reminder_key = COALESCE(reminder_key, ?),
     beaten_mails_on_at = CASE WHEN ? THEN ? ELSE NULL END WHERE id = ?`,
    body.on ? 1 : 0,
    randomBytes(16).toString('base64url'),
    body.on ? 1 : 0,
    Date.now(),
    res.locals.userId,
  );
  res.json({ user: getMe(res.locals.userId) });
});

/** Others may play against this player's recorded matches (a recording plays when nobody's there for a Дуел). */
accountRouter.post('/account/share-runs', requireAuth, requireAccount, (req, res) => {
  const body = parse(z.object({ on: z.boolean() }), req, res);
  if (!body) return;
  run('UPDATE users SET share_runs = ? WHERE id = ?', body.on ? 1 : 0, res.locals.userId);
  res.json({ user: getMe(res.locals.userId) });
});

/** Your friend duels: whose turn it is in the open ones, and how the week's ended. */
accountRouter.get('/duels', requireAuth, (_req, res) => {
  res.json({ duels: myDuels(res.locals.userId) });
});

/** The unsubscribe link in reminder emails (and the mail apps' one-click unsubscribe): no sign-in needed. */
accountRouter.post('/reminders/off', (req, res) => {
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

accountRouter.get('/account/export', requireAuth, (_req, res) => {
  // Everything ever played, built on the thread the matches run on: a few a while is plenty.
  if (throttled(`export:${res.locals.userId}`, 3, 10 * 60_000)) {
    res.status(429).json({ error: 'Вече изтегли данните си. Опитай пак след няколко минути.' });
    return;
  }
  res.setHeader('content-disposition', 'attachment; filename="almanac-data.json"');
  res.type('application/json').send(JSON.stringify(exportAccount(res.locals.userId), null, 2));
});

accountRouter.post('/account/delete', requireAuth, async (req, res) => {
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

accountRouter.get('/notifications', requireAuth, (_req, res) => {
  res.json({ notifications: listNotifications(res.locals.userId) });
});

accountRouter.post('/notifications/read', requireAuth, (_req, res) => {
  markNotificationsRead(res.locals.userId);
  res.json({ ok: true });
});

accountRouter.get('/achievements', requireAuth, (_req, res) => {
  res.json({ achievements: achievementProgress(res.locals.userId) });
});

/** The key a device subscribes with (null: this site has no push set up). */
accountRouter.get('/push/key', (_req, res) => {
  res.json({ key: config.vapid?.publicKey ?? null });
});

/** This device gets pushes; the first one confirms it works. */
accountRouter.post('/push/subscribe', requireAuth, requireAccount, (req, res) => {
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

accountRouter.post('/push/unsubscribe', requireAuth, (req, res) => {
  const body = parse(z.object({ endpoint: z.string().max(1000) }), req, res);
  if (!body) return;
  unsubscribe(res.locals.userId, body.endpoint);
  res.json({ ok: true });
});

accountRouter.post('/push/prefs', requireAuth, requireAccount, (req, res) => {
  const prefs = parse(PrefsSchema, req, res);
  if (!prefs) return;
  setPushPrefs(res.locals.userId, prefs);
  res.json({ user: getMe(res.locals.userId) });
});
