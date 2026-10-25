import {
  type CategoryId,
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
  type SubmissionStatus,
} from '@quiz/shared';
import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { deleteAccount, exportAccount, getMe, settleAccount, updateLoadout } from '../account';
import { achievementProgress } from '../achievements';
import {
  createSession,
  destroySession,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  hashToken,
  requireAuth,
  sessionTokenFromCookieHeader,
  setSessionCookie,
  userIdFromRequest,
  verifyPassword,
} from '../auth';
import { config } from '../config';
import { dailyInfo, liveDailyStreak } from '../daily';
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
import { all, one, run } from '../db';
import { acceptFriend, type FriendResult, friendship, listFriends, removeFriend, requestFriend } from '../friends';
import { activeBan, fileReport, nameProblem, openReportCount, openReports, resolveReports } from '../moderation';
import { disconnectSession, notifyUser, sendFriendsUpdate } from '../notify';
import {
  hiddenQuestions,
  openQuestionReportCount,
  openQuestionReports,
  reportQuestion,
  resolveQuestionReports,
  unhideQuestion,
} from '../questionReports';
import { throttled } from '../throttle';
import { getRatings, markSeasonRewardsSeen, seasonHistory, seasonInfo } from '../seasons';
import {
  approveSubmission,
  DraftSchema,
  listSubmissions,
  mySubmissions,
  pendingCount,
  rejectSubmission,
  submitQuestion,
} from '../submissions';
import { emailKey, getUser, getUserByLogin, getUserByName, isAdmin, toPublicUser, type UserRow, usernameKey } from '../users';

export const api = Router();

const Credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Името трябва да е поне 3 символа.')
    .max(20, 'Името може да е най-много 20 символа.')
    .regex(/^[\p{L}\p{N}_.-]+$/u, 'Само букви, цифри, точка, тире и долна черта.'),
  password: PasswordSchema,
});

const Registration = Credentials.extend({ email: z.union([z.literal(''), EmailSchema]).optional() });

/** Login takes a username or a verified email. */
const Login = z.object({
  username: z.string().trim().min(1, 'Въведи име или имейл.').max(254),
  password: z.string().min(1, 'Въведи парола.').max(200),
});

function parse<T>(schema: z.ZodType<T>, req: Request, res: Response): T | null {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Невалидни данни.' });
    return null;
  }
  return parsed.data;
}

function requireAdmin(_req: Request, res: Response, next: NextFunction) {
  const user = getUser(res.locals.userId);
  if (!user || !isAdmin(user)) {
    res.status(403).json({ error: 'Само за модератори.' });
    return;
  }
  next();
}

const idParam = (req: Request) => Number(req.params.id);

// ─── Auth ────────────────────────────────────────────────────────────────────

api.post('/auth/register', async (req, res) => {
  // Generous per-IP limit: a whole school class may sign up from one network.
  if (throttled(`register:${req.ip}`, 30, 60 * 60_000)) {
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
  if (getUserByName(creds.username)) {
    res.status(409).json({ error: 'Това име вече е заето.' });
    return;
  }
  const hash = await hashPassword(creds.password);
  // In development the very first account runs the place. In production nobody gets admin by signing up: moderators
  // are made with the admin command line (src/cli.ts), so no name can be claimed by someone faster.
  const firstUser = !config.production && one<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n === 0;
  const { lastInsertRowid } = run(
    'INSERT INTO users (username, username_key, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?, ?)',
    creds.username,
    usernameKey(creds.username),
    hash,
    Date.now(),
    firstUser ? 1 : 0,
  );
  const userId = Number(lastInsertRowid);
  if (creds.email) requestEmailChange(userId, creds.email);
  setSessionCookie(res, createSession(userId));
  res.status(201).json({ user: getMe(userId) });
});

api.post('/auth/login', async (req, res) => {
  const creds = parse(Login, req, res);
  if (!creds) return;
  // Per IP and account, per IP across accounts (password spraying), and per account across IPs (distributed guessing).
  const account = usernameKey(creds.username);
  if (
    throttled(`login:${req.ip}:${account}`) ||
    throttled(`login-ip:${req.ip}`, 40, 15 * 60_000) ||
    throttled(`login-account:${account}`, 30, 15 * 60_000)
  ) {
    res.status(429).json({ error: 'Твърде много опити. Изчакай няколко минути.' });
    return;
  }
  const user = getUserByLogin(creds.username);
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
  setSessionCookie(res, createSession(user.id));
  res.json({ user: getMe(user.id) });
});

/** Always answers the same way, so it can't be used to discover accounts or emails. */
api.post('/auth/forgot', (req, res) => {
  const body = parse(z.object({ login: z.string().trim().min(1, 'Въведи име или имейл.').max(254) }), req, res);
  if (!body) return;
  if (throttled(`forgot-ip:${req.ip}`, 5, 15 * 60_000) || throttled(`forgot:${usernameKey(body.login)}`, 3, 60 * 60_000)) {
    res.status(429).json({ error: 'Твърде много заявки. Опитай по-късно.' });
    return;
  }
  requestPasswordReset(body.login);
  res.json({ ok: true });
});

api.post('/auth/reset', async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10).max(200), password: PasswordSchema }), req, res);
  if (!body) return;
  if (throttled(`reset:${req.ip}`, 10, 15 * 60_000)) {
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
  res.json({ user: getMe(result.userId) });
});

/** The token alone proves mailbox ownership, so this works signed out too. */
api.post('/auth/verify-email', (req, res) => {
  const body = parse(z.object({ token: z.string().min(10).max(200) }), req, res);
  if (!body) return;
  const result = verifyEmailToken(body.token);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
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

// ─── Me ──────────────────────────────────────────────────────────────────────

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

api.post('/account/email', requireAuth, async (req, res) => {
  const body = parse(z.object({ email: z.string().max(254), password: z.string().max(200).optional() }), req, res);
  if (!body) return;
  if (throttled(`email:${res.locals.userId}`, 5, 60 * 60_000) || throttled(`email-to:${emailKey(body.email)}`, 3, 24 * 60 * 60_000)) {
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
  const result = requestEmailChange(res.locals.userId, body.email);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ user: getMe(res.locals.userId) });
});

api.delete('/account/email', requireAuth, async (req, res) => {
  const body = parse(z.object({ password: z.string().min(1, 'Въведи паролата си.').max(200) }), req, res);
  if (!body || !(await confirmPassword(res, body.password))) return;
  removeEmail(res.locals.userId);
  res.json({ user: getMe(res.locals.userId) });
});

api.post('/account/password', requireAuth, async (req, res) => {
  const body = parse(z.object({ current: z.string().min(1, 'Въведи текущата парола.').max(200), next: PasswordSchema }), req, res);
  if (!body) return;
  if (throttled(`password:${res.locals.userId}`, 10, 15 * 60_000)) {
    res.status(429).json({ error: 'Твърде много опити. Изчакай няколко минути.' });
    return;
  }
  const result = await changePassword(res.locals.userId, body.current, body.next, sessionTokenFromCookieHeader(req.headers.cookie));
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

api.get('/account/export', requireAuth, (_req, res) => {
  res.setHeader('content-disposition', 'attachment; filename="almanac-data.json"');
  res.type('application/json').send(JSON.stringify(exportAccount(res.locals.userId), null, 2));
});

api.post('/account/delete', requireAuth, async (req, res) => {
  const body = parse(z.object({ password: z.string().min(1, 'Въведи паролата си.').max(200) }), req, res);
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

/** Crashes in players' browsers land in the server log (there's no other way to hear about them). */
api.post('/client-errors', (req, res) => {
  const body = z
    .object({
      message: z.string().max(500),
      stack: z.string().max(4000).optional(),
      url: z.string().max(300).optional(),
      kind: z.enum(['render', 'error', 'rejection']),
    })
    .safeParse(req.body);
  if (body.success && !throttled(`client-error:${req.ip}`, 20, 10 * 60_000)) {
    // Untrusted text: one line for the message, an indented block for the stack, so it can't forge log entries.
    const line = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ');
    const { kind, message, url, stack } = body.data;
    const trace = stack ? `\n${stack.split('\n').map((l) => `    | ${line(l)}`).join('\n')}` : '';
    console.error(`🧯 Browser ${kind} at ${line(url ?? '?')}: ${line(message)}${trace}`);
  }
  res.status(204).end();
});

api.post('/reports', requireAuth, (req, res) => {
  const body = parse(
    z.object({ username: z.string().trim().min(1).max(40), reason: z.string(), details: z.string().max(500).default('') }),
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

api.get('/achievements', requireAuth, (_req, res) => {
  res.json({ achievements: achievementProgress(res.locals.userId) });
});

// ─── Daily & seasons ─────────────────────────────────────────────────────────

api.get('/daily', requireAuth, (_req, res) => {
  res.json(dailyInfo(res.locals.userId));
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

api.post('/friends', requireAuth, (req, res) => {
  const body = parse(z.object({ username: z.string().trim().min(1, 'Въведи име.').max(40) }), req, res);
  if (!body) return;
  // Per sender, and per pair (removing and re-requesting the same player can't become a notification loop).
  const pair = `${res.locals.userId}:${usernameKey(body.username)}`;
  if (throttled(`friend-request:${res.locals.userId}`, 30, 60 * 60_000) || throttled(`friend-pair:${pair}`, 3, 24 * 60 * 60_000)) {
    res.status(429).json({ error: 'Твърде много покани. Опитай по-късно.' });
    return;
  }
  friendReply(res, res.locals.userId, requestFriend(res.locals.userId, body.username));
});

api.post('/friends/:id/accept', requireAuth, (req, res) => {
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

// ─── Community questions ─────────────────────────────────────────────────────

api.get('/submissions/mine', requireAuth, (_req, res) => {
  res.json({ submissions: mySubmissions(res.locals.userId) });
});

api.post('/submissions', requireAuth, (req, res) => {
  const draft = parse(DraftSchema, req, res);
  if (!draft) return;
  const result = submitQuestion(res.locals.userId, draft);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.status(201).json({ submission: result.submission });
});

api.get('/admin/submissions', requireAuth, requireAdmin, (req, res) => {
  const status = z.enum(['pending', 'approved', 'rejected']).catch('pending').parse(req.query.status) as SubmissionStatus;
  res.json({ submissions: listSubmissions(status), pending: pendingCount() });
});

api.get('/admin/summary', requireAuth, requireAdmin, (_req, res) => {
  res.json({ pendingQuestions: pendingCount(), openReports: openReportCount(), questionReports: openQuestionReportCount() });
});

api.post('/questions/:id/report', requireAuth, (req, res) => {
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

api.get('/admin/question-reports', requireAuth, requireAdmin, (_req, res) => {
  res.json({ groups: openQuestionReports(), hidden: hiddenQuestions() });
});

api.post('/admin/question-reports/:id/resolve', requireAuth, requireAdmin, (req, res) => {
  const body = parse(z.object({ action: z.enum(['dismiss', 'hide']) }), req, res);
  if (!body) return;
  const result = resolveQuestionReports(res.locals.userId, String(req.params.id), body.action);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ groups: openQuestionReports(), hidden: hiddenQuestions() });
});

api.post('/admin/hidden-questions/:id/unhide', requireAuth, requireAdmin, (req, res) => {
  const result = unhideQuestion(String(req.params.id));
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ groups: openQuestionReports(), hidden: hiddenQuestions() });
});

api.get('/admin/reports', requireAuth, requireAdmin, (_req, res) => {
  res.json({ groups: openReports() });
});

const Decision = z.discriminatedUnion('action', [
  z.object({ action: z.literal('dismiss') }),
  z.object({ action: z.literal('rename'), username: z.string().max(40) }),
  z.object({ action: z.literal('ban'), days: z.number().int().min(1).max(3650).nullable(), reason: z.string().max(200).default('') }),
]);

api.post('/admin/reports/:id/resolve', requireAuth, requireAdmin, (req, res) => {
  const decision = parse(Decision, req, res);
  if (!decision) return;
  const result = resolveReports(res.locals.userId, idParam(req), decision);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true, groups: openReports() });
});

api.post('/admin/submissions/:id/approve', requireAuth, requireAdmin, (req, res) => {
  const body = parse(z.object({ edits: DraftSchema.nullable().optional() }), req, res);
  if (!body) return;
  const result = approveSubmission(res.locals.userId, idParam(req), body.edits ?? null);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true, pending: pendingCount() });
});

api.post('/admin/submissions/:id/reject', requireAuth, requireAdmin, (req, res) => {
  const body = parse(z.object({ reason: z.string().max(300).default('') }), req, res);
  if (!body) return;
  const result = rejectSubmission(res.locals.userId, idParam(req), body.reason);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true, pending: pendingCount() });
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
    categories: all<{ category: CategoryId; answered: number; correct: number }>(
      'SELECT category, answered, correct FROM category_stats WHERE user_id = ?',
      u.id,
    ),
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
    ).map((a) => ({ id: a.achievement_id, unlockedAt: a.unlocked_at })),
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
      me: info.played ? { rank: info.played.rank, user: toPublicUser(me), value: info.played.score, correct: info.played.correct } : null,
      season: null,
    };
  }

  if (board === 'level') {
    const rows = all<BoardRow>('SELECT * FROM users ORDER BY xp DESC, id ASC LIMIT ?', LIMIT);
    const me = getUser(userId)!;
    const rank = one<{ n: number }>('SELECT COUNT(*) + 1 AS n FROM users WHERE xp > ?', me.xp)!.n;
    return { board, entries: rows.map((r, i) => toEntry(r, i + 1)), me: toEntry(me, rank), season: null };
  }

  const season = seasonKey();
  const mode: QueueModeId = board;
  const rows = all<BoardRow>(
    `SELECT u.*, r.rating, r.games, r.wins FROM season_ratings r JOIN users u ON u.id = r.user_id
     WHERE r.season = ? AND r.mode = ? AND r.games > 0 ORDER BY r.rating DESC, u.id ASC LIMIT ?`,
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
        'SELECT COUNT(*) + 1 AS n FROM season_ratings WHERE season = ? AND mode = ? AND games > 0 AND rating > ?',
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
