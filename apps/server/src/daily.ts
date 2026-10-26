import { type DailyInfo, dayEndsAt, dayKey, daysBetween, MODES, STREAK_SHIELDS } from '@quiz/shared';
import { config } from './config';
import { all, one, run } from './db';
import { friendIds } from './friends';
import { type PreparedQuestion, pickQuestions, recentFor, reorderOptions, seededRng } from './questions';
import { installationSecret } from './settings';
import { count } from './stats';
import { getUser, toPublicUser, type UserRow } from './users';

/** Today's question set — generated once per day from a date seed, then frozen in the database. */
function dailySet(day: string): PreparedQuestion[] {
  const existing = one<{ questions: string }>('SELECT questions FROM daily_sets WHERE day = ?', day);
  if (existing) return JSON.parse(existing.questions);
  // The seed includes this installation's secret: with the code public, a date alone mustn't reveal the questions.
  const questions = pickQuestions(
    MODES.daily.questions,
    'mixed',
    new Map(),
    seededRng(`daily:${installationSecret('daily-seed')}:${day}`),
  );
  run('INSERT OR IGNORE INTO daily_sets (day, questions) VALUES (?, ?)', day, JSON.stringify(questions));
  return JSON.parse(one<{ questions: string }>('SELECT questions FROM daily_sets WHERE day = ?', day)!.questions);
}

/**
 * A question was just hidden (a moderator found it wrong): if it's in the day's set and no account has started the
 * daily yet, the set is drawn again without it. Once someone has played, the set stands — the board compares the same
 * ten questions for everyone. Guests don't count: they play questions of their own.
 */
export function redrawDailyWithout(questionId: string, day = dayKey()): boolean {
  const set = one<{ questions: string }>('SELECT questions FROM daily_sets WHERE day = ?', day);
  if (!set || !(JSON.parse(set.questions) as PreparedQuestion[]).some((q) => q.id === questionId)) return false;
  const started = one(
    'SELECT 1 AS x FROM daily_results r JOIN users u ON u.id = r.user_id WHERE r.day = ? AND u.is_guest = 0 LIMIT 1',
    day,
  );
  if (started) return false;
  run('DELETE FROM daily_sets WHERE day = ?', day);
  return true;
}

/**
 * The day's questions as this player sees them: the same questions in the same order for everyone, but each player
 * gets their own option order — so "Б, А, Г…" from a friend (or a second account) gives nothing away.
 */
export function dailyQuestions(day: string, userId: number): PreparedQuestion[] {
  return reorderOptions(dailySet(day), `daily:${day}:${userId}`);
}

/**
 * A guest's run of the day: ten questions of its own rather than the shared set. A guest costs one click, so with the
 * shared set anyone could read the day's answers off a throwaway guest and then top the board with their real profile.
 * Guests aren't on the board anyway; saving the profile opens the shared set to them (forgetGuestDaily).
 */
export function guestDailyQuestions(userId: number): PreparedQuestion[] {
  return pickQuestions(MODES.daily.questions, 'mixed', recentFor([userId]));
}

/** A guest just saved their profile: today's guest run (its own questions) makes way for the shared set and the board. */
export function forgetGuestDaily(userId: number) {
  run('DELETE FROM daily_results WHERE user_id = ? AND day = ?', userId, dayKey());
}

/**
 * Claims today's single attempt. Starting counts — leaving or disconnecting doesn't give a retry; only a server restart
 * that cut the attempt short does.
 */
export function claimDailyAttempt(userId: number): { ok: true; day: string } | { ok: false; error: string } {
  const day = dayKey();
  const existing = one<{ started_at: number; finished_at: number | null }>(
    'SELECT started_at, finished_at FROM daily_results WHERE user_id = ? AND day = ?',
    userId,
    day,
  );
  if (existing && !existing.finished_at && existing.started_at < config.bootedAt) {
    run('UPDATE daily_results SET started_at = ? WHERE user_id = ? AND day = ?', Date.now(), userId, day);
    return { ok: true, day };
  }
  if (existing) {
    return {
      ok: false,
      error: existing.finished_at
        ? 'Вече изигра днешното предизвикателство. Ново има утре!'
        : 'Днешният опит вече е започнат — имаш само един на ден.',
    };
  }
  run('INSERT INTO daily_results (user_id, day, started_at) VALUES (?, ?, ?)', userId, day, Date.now());
  count('daily_runs');
  return { ok: true, day };
}

/** The run never got going (or its result couldn't be saved): the day's one attempt is the player's again. */
export function releaseDailyAttempt(userId: number, day: string) {
  run('DELETE FROM daily_results WHERE user_id = ? AND day = ? AND finished_at IS NULL', userId, day);
}

/** Place on the day's board, and how many are on it. A guest's run has questions of its own: no place for it. */
function rankOf(day: string, score: number, timeMs: number, guest = false): { rank: number | null; total: number } {
  const listed = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM daily_results d JOIN users u ON u.id = d.user_id
     WHERE d.day = ? AND d.finished_at IS NOT NULL AND u.is_guest = 0`,
    day,
  )!.n;
  if (guest) return { rank: null, total: listed };
  const better = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM daily_results d JOIN users u ON u.id = d.user_id
     WHERE d.day = ? AND d.finished_at IS NOT NULL AND u.is_guest = 0
     AND (d.score > ? OR (d.score = ? AND d.time_ms < ?))`,
    day,
    score,
    score,
    timeMs,
  )!.n;
  return { rank: better + 1, total: listed };
}

/** Saves the result and advances the player's day streak. */
export function recordDailyResult(userId: number, day: string, score: number, correct: number, timeMs: number) {
  run(
    'UPDATE daily_results SET finished_at = ?, score = ?, correct = ?, time_ms = ? WHERE user_id = ? AND day = ?',
    Date.now(),
    score,
    correct,
    timeMs,
    userId,
    day,
  );
  const u = getUser(userId)!;
  const guest = u.is_guest === 1;
  if (u.last_daily_day === day)
    return { ...rankOf(day, score, timeMs, guest), streak: u.daily_streak, shieldsUsed: 0, shieldEarned: false };

  // Consecutive day: the streak grows. Missed days are covered by shields, one each, if there are enough.
  const missed = u.last_daily_day ? daysBetween(u.last_daily_day, day) - 1 : Infinity;
  let shields = u.streak_shields;
  let shieldsUsed = 0;
  let streak = 1;
  if (missed === 0) streak = u.daily_streak + 1;
  else if (missed <= shields && u.daily_streak > 0) {
    shields -= missed;
    shieldsUsed = missed;
    streak = u.daily_streak + 1;
  }
  const shieldEarned = streak % STREAK_SHIELDS.every === 0 && shields < STREAK_SHIELDS.max;
  if (shieldEarned) shields++;
  run(
    `UPDATE users SET daily_streak = ?, best_daily_streak = MAX(best_daily_streak, ?), last_daily_day = ?, streak_shields = ?
     WHERE id = ?`,
    streak,
    streak,
    day,
    shields,
    userId,
  );
  return { ...rankOf(day, score, timeMs, guest), streak, shieldsUsed, shieldEarned };
}

/** A streak only counts while it's alive: played today or yesterday, or the days missed since are covered by shields. */
export function liveDailyStreak(
  u: Pick<UserRow, 'daily_streak' | 'last_daily_day' | 'streak_shields'>,
  today = dayKey(),
) {
  if (!u.last_daily_day) return 0;
  return daysBetween(u.last_daily_day, today) - 1 <= u.streak_shields ? u.daily_streak : 0;
}

/** The day among friends: you and your friends who finished it, ranked like the board (score, then time). */
function friendsToday(day: string, userId: number) {
  const ids = [userId, ...friendIds(userId)];
  const rows = all<UserRow & { score: number; correct: number }>(
    `SELECT u.*, d.score, d.correct FROM daily_results d JOIN users u ON u.id = d.user_id
     WHERE d.day = ? AND d.finished_at IS NOT NULL AND d.user_id IN (${ids.map(() => '?').join(', ')})
     ORDER BY d.score DESC, d.time_ms ASC`,
    day,
    ...ids,
  );
  return rows.map((r, i) => ({ rank: i + 1, user: toPublicUser(r), value: r.score, correct: r.correct }));
}

export function dailyInfo(userId: number): DailyInfo {
  const day = dayKey();
  const mine = one<{
    finished_at: number | null;
    score: number | null;
    correct: number | null;
    time_ms: number | null;
  }>('SELECT finished_at, score, correct, time_ms FROM daily_results WHERE user_id = ? AND day = ?', userId, day);
  const rows = all<UserRow & { score: number; correct: number }>(
    `SELECT u.*, d.score, d.correct FROM daily_results d JOIN users u ON u.id = d.user_id
     WHERE d.day = ? AND d.finished_at IS NOT NULL AND u.is_guest = 0 ORDER BY d.score DESC, d.time_ms ASC LIMIT 50`,
    day,
  );
  const me = getUser(userId)!;
  const guest = me.is_guest === 1;
  const played = mine?.finished_at
    ? { score: mine.score!, correct: mine.correct!, ...rankOf(day, mine.score!, mine.time_ms!, guest) }
    : null;
  return {
    day,
    endsAt: dayEndsAt(day),
    streak: liveDailyStreak(me),
    attempted: !!mine,
    played: played && { score: played.score, correct: played.correct, rank: played.rank },
    total: rankOf(day, 0, 0, true).total,
    entries: rows.map((r, i) => ({ rank: i + 1, user: toPublicUser(r), value: r.score, correct: r.correct })),
    friends: guest ? [] : friendsToday(day, userId),
  };
}
