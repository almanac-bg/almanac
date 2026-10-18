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
import { getMe, settleAccount, updateLoadout } from '../account';
import { achievementProgress } from '../achievements';
import {
  createSession,
  destroySession,
  hashPassword,
  requireAuth,
  sessionTokenFromCookieHeader,
  setSessionCookie,
  userIdFromCookieHeader,
  verifyPassword,
} from '../auth';
import { dailyInfo, liveDailyStreak } from '../daily';
import { all, one, run } from '../db';
import { acceptFriend, type FriendResult, friendship, listFriends, removeFriend, requestFriend } from '../friends';
import { notifyUser } from '../notify';
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
import { getUser, getUserByName, isAdmin, toPublicUser, type UserRow, usernameKey } from '../users';

export const api = Router();

const Credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Името трябва да е поне 3 символа.')
    .max(20, 'Името може да е най-много 20 символа.')
    .regex(/^[\p{L}\p{N}_.-]+$/u, 'Само букви, цифри, точка, тире и долна черта.'),
  password: z.string().min(6, 'Паролата трябва да е поне 6 символа.').max(200),
});

/** Tiny in-memory throttle for auth endpoints: N attempts per key per window. */
const attempts = new Map<string, { count: number; resetAt: number }>();
function throttled(key: string, limit = 10, windowMs = 5 * 60_000): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count++;
  return entry.count > limit;
}

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
  if (throttled(`register:${req.ip}`, 5, 60 * 60_000)) {
    res.status(429).json({ error: 'Твърде много регистрации. Опитай по-късно.' });
    return;
  }
  const creds = parse(Credentials, req, res);
  if (!creds) return;
  if (getUserByName(creds.username)) {
    res.status(409).json({ error: 'Това име вече е заето.' });
    return;
  }
  const hash = await hashPassword(creds.password);
  // The very first account runs the place.
  const firstUser = one<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n === 0;
  const { lastInsertRowid } = run(
    'INSERT INTO users (username, username_key, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?, ?)',
    creds.username,
    usernameKey(creds.username),
    hash,
    Date.now(),
    firstUser ? 1 : 0,
  );
  const userId = Number(lastInsertRowid);
  setSessionCookie(res, createSession(userId));
  res.status(201).json({ user: getMe(userId) });
});

api.post('/auth/login', async (req, res) => {
  const creds = parse(Credentials, req, res);
  if (!creds) return;
  if (throttled(`login:${req.ip}:${usernameKey(creds.username)}`)) {
    res.status(429).json({ error: 'Твърде много опити. Изчакай няколко минути.' });
    return;
  }
  const user = getUserByName(creds.username);
  if (!user || !(await verifyPassword(creds.password, user.password_hash))) {
    res.status(401).json({ error: 'Грешно име или парола.' });
    return;
  }
  setSessionCookie(res, createSession(user.id));
  res.json({ user: getMe(user.id) });
});

api.post('/auth/logout', (req, res) => {
  const token = sessionTokenFromCookieHeader(req.headers.cookie);
  if (token) destroySession(token);
  setSessionCookie(res, null);
  res.json({ ok: true });
});

// ─── Me ──────────────────────────────────────────────────────────────────────

/** Signed-out visitors get `{ user: null }` rather than a 401, so the first page load stays quiet. */
api.get('/me', (req, res) => {
  const userId = userIdFromCookieHeader(req.headers.cookie);
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
  notifyUser(result.otherId, 'friends:update');
  notifyUser(me, 'friends:update');
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
  const body = parse(z.object({ username: z.string().trim().min(1, 'Въведи име.') }), req, res);
  if (!body) return;
  friendReply(res, res.locals.userId, requestFriend(res.locals.userId, body.username));
});

api.post('/friends/:id/accept', requireAuth, (req, res) => {
  friendReply(res, res.locals.userId, acceptFriend(res.locals.userId, idParam(req)));
});

api.delete('/friends/:id', requireAuth, (req, res) => {
  const other = idParam(req);
  if (removeFriend(res.locals.userId, other)) {
    notifyUser(other, 'friends:update');
    notifyUser(res.locals.userId, 'friends:update');
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
