import { type DailyInfo, dayEndsAt, dayKey, daysBetween, MODES, STREAK_SHIELDS } from '@quiz/shared';
import { config } from './config';
import { all, one, run } from './db';
import { friendIds } from './friends';
import { type PreparedQuestion, pickQuestions, recentFor, reorderOptions, seededRng } from './questions';
import { installationSecret } from './settings';
import { count } from './stats';
import { playsSharedDaily } from './trust';
import { getUser, toPublicUser, type UserRow } from './users';

/** A run on the shared set: what the board and the friends' view compare (a run from older code: a guest's wasn't). */
const SHARED_RUN = 'COALESCE(d.own_set, u.is_guest) = 0';

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
 * A question was just hidden (a moderator found it wrong): if it's in the day's set and nobody has started it yet, the
 * set is drawn again without it. Once someone has played, the set stands — the board compares the same ten questions
 * for everyone. Runs on questions of their own (guests, accounts made today) don't count.
 */
export function redrawDailyWithout(questionId: string, day = dayKey()): boolean {
  const set = one<{ questions: string }>('SELECT questions FROM daily_sets WHERE day = ?', day);
  if (!set || !(JSON.parse(set.questions) as PreparedQuestion[]).some((q) => q.id === questionId)) return false;
  const started = one(
    `SELECT 1 AS x FROM daily_results d JOIN users u ON u.id = d.user_id WHERE d.day = ? AND ${SHARED_RUN} LIMIT 1`,
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
 * The run of a guest, or of an account made today: ten questions of its own rather than the shared set (playsSharedDaily).
 * A second account costs seconds, so with the shared set anyone could read the day's answers off a throwaway and then
 * top the board with their real profile. These runs aren't on the board; tomorrow the shared set opens to the account.
 */
export function ownDailyQuestions(userId: number): PreparedQuestion[] {
  return pickQuestions(MODES.daily.questions, 'mixed', recentFor([userId]));
}

/**
 * A guest just saved their profile. Made before today, the account plays the shared set now: today's guest run (its
 * own questions) makes way for it. Made today, the run stands, and the shared set opens tomorrow.
 */
export function forgetGuestDaily(userId: number) {
  const user = getUser(userId);
  if (!user || !playsSharedDaily(user)) return;
  run('DELETE FROM daily_results WHERE user_id = ? AND day = ?', userId, dayKey());
}

/**
 * Claims today's single attempt. Starting counts — leaving or disconnecting doesn't give a retry; only a server restart
 * that cut the attempt short does.
 */
export function claimDailyAttempt(
  userId: number,
): { ok: true; day: string; ownSet: boolean } | { ok: false; error: string } {
  const day = dayKey();
  const existing = one<{ started_at: number; finished_at: number | null; own_set: number | null }>(
    'SELECT started_at, finished_at, own_set FROM daily_results WHERE user_id = ? AND day = ?',
    userId,
    day,
  );
  if (existing && !existing.finished_at && existing.started_at < config.bootedAt) {
    run('UPDATE daily_results SET started_at = ? WHERE user_id = ? AND day = ?', Date.now(), userId, day);
    return { ok: true, day, ownSet: existing.own_set === 1 };
  }
  if (existing) {
    return {
      ok: false,
      error: existing.finished_at
        ? 'Вече изигра днешното предизвикателство. Ново има утре!'
        : 'Днешният опит вече е започнат — имаш само един на ден.',
    };
  }
  const ownSet = !playsSharedDaily(getUser(userId)!, day);
  run(
    'INSERT INTO daily_results (user_id, day, started_at, own_set) VALUES (?, ?, ?, ?)',
    userId,
    day,
    Date.now(),
    ownSet ? 1 : 0,
  );
  count('daily_runs');
  return { ok: true, day, ownSet };
}

/** The run never got going (or its result couldn't be saved): the day's one attempt is the player's again. */
export function releaseDailyAttempt(userId: number, day: string) {
  run('DELETE FROM daily_results WHERE user_id = ? AND day = ? AND finished_at IS NULL', userId, day);
}

/** Place on the day's board, and how many are on it. A run on questions of its own has no place on it. */
function rankOf(day: string, score: number, timeMs: number, ownSet = false): { rank: number | null; total: number } {
  const listed = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM daily_results d JOIN users u ON u.id = d.user_id
     WHERE d.day = ? AND d.finished_at IS NOT NULL AND ${SHARED_RUN}`,
    day,
  )!.n;
  if (ownSet) return { rank: null, total: listed };
  const better = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM daily_results d JOIN users u ON u.id = d.user_id
     WHERE d.day = ? AND d.finished_at IS NOT NULL AND ${SHARED_RUN}
     AND (d.score > ? OR (d.score = ? AND d.time_ms < ?))`,
    day,
    score,
    score,
    timeMs,
  )!.n;
  return { rank: better + 1, total: listed };
}

/**
 * Saves the result and, when the run was played (`played`: at least half of it, not walked out of in the first
 * questions), advances the player's day streak. A run left at once uses the day's attempt but isn't a day played.
 */
export function recordDailyResult(
  userId: number,
  day: string,
  score: number,
  correct: number,
  timeMs: number,
  played: boolean,
) {
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
  const ownSet = one<{ own_set: number | null }>(
    'SELECT own_set FROM daily_results WHERE user_id = ? AND day = ?',
    userId,
    day,
  )?.own_set;
  const rank = rankOf(day, score, timeMs, (ownSet ?? u.is_guest) === 1);
  if (u.last_daily_day === day || !played)
    return { ...rank, streak: liveDailyStreak(u, day), shieldsUsed: 0, shieldEarned: false };

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
  return { ...rank, streak, shieldsUsed, shieldEarned };
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
     WHERE d.day = ? AND d.finished_at IS NOT NULL AND ${SHARED_RUN} AND d.user_id IN (${ids.map(() => '?').join(', ')})
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
    own_set: number | null;
  }>(
    'SELECT finished_at, score, correct, time_ms, own_set FROM daily_results WHERE user_id = ? AND day = ?',
    userId,
    day,
  );
  const rows = all<UserRow & { score: number; correct: number }>(
    `SELECT u.*, d.score, d.correct FROM daily_results d JOIN users u ON u.id = d.user_id
     WHERE d.day = ? AND d.finished_at IS NOT NULL AND ${SHARED_RUN} ORDER BY d.score DESC, d.time_ms ASC LIMIT 50`,
    day,
  );
  const me = getUser(userId)!;
  const guest = me.is_guest === 1;
  // Today's run as it was started; one not started yet goes by the account as it is now.
  const ownSet = mine ? (mine.own_set ?? me.is_guest) === 1 : !playsSharedDaily(me, day);
  const played = mine?.finished_at
    ? { score: mine.score!, correct: mine.correct!, ...rankOf(day, mine.score!, mine.time_ms!, ownSet) }
    : null;
  return {
    day,
    endsAt: dayEndsAt(day),
    streak: liveDailyStreak(me),
    attempted: !!mine,
    ownSet,
    played: played && { score: played.score, correct: played.correct, rank: played.rank },
    total: rankOf(day, 0, 0, true).total,
    entries: rows.map((r, i) => ({ rank: i + 1, user: toPublicUser(r), value: r.score, correct: r.correct })),
    friends: guest ? [] : friendsToday(day, userId),
  };
}
