import { type DailyInfo, dayEndsAt, dayKey, MODES, shiftDay } from '@quiz/shared';
import { all, one, run } from './db';
import { pickQuestions, type PreparedQuestion, seededRng } from './questions';
import { getUser, toPublicUser, type UserRow } from './users';

/** Today's question set — generated once per day from a date seed, then frozen in the database. */
export function dailyQuestions(day = dayKey()): PreparedQuestion[] {
  const existing = one<{ questions: string }>('SELECT questions FROM daily_sets WHERE day = ?', day);
  if (existing) return JSON.parse(existing.questions);
  const questions = pickQuestions(MODES.daily.questions, 'mixed', new Set(), seededRng(`daily:${day}`));
  run('INSERT OR IGNORE INTO daily_sets (day, questions) VALUES (?, ?)', day, JSON.stringify(questions));
  return JSON.parse(one<{ questions: string }>('SELECT questions FROM daily_sets WHERE day = ?', day)!.questions);
}

/** Claims today's single attempt. Starting counts — leaving or disconnecting doesn't give a retry. */
export function claimDailyAttempt(userId: number): { ok: true; day: string } | { ok: false; error: string } {
  const day = dayKey();
  const existing = one<{ finished_at: number | null }>(
    'SELECT finished_at FROM daily_results WHERE user_id = ? AND day = ?',
    userId,
    day,
  );
  if (existing) {
    return {
      ok: false,
      error: existing.finished_at
        ? 'Вече изигра днешното предизвикателство. Ново има утре!'
        : 'Днешният опит вече е започнат — имаш само един на ден.',
    };
  }
  run('INSERT INTO daily_results (user_id, day, started_at) VALUES (?, ?, ?)', userId, day, Date.now());
  return { ok: true, day };
}

function rankOf(day: string, score: number, timeMs: number) {
  const better = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM daily_results WHERE day = ? AND finished_at IS NOT NULL
     AND (score > ? OR (score = ? AND time_ms < ?))`,
    day,
    score,
    score,
    timeMs,
  )!.n;
  const total = one<{ n: number }>('SELECT COUNT(*) AS n FROM daily_results WHERE day = ? AND finished_at IS NOT NULL', day)!.n;
  return { rank: better + 1, total };
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
  const streak = u.last_daily_day === day ? u.daily_streak : u.last_daily_day === shiftDay(day, -1) ? u.daily_streak + 1 : 1;
  run(
    'UPDATE users SET daily_streak = ?, best_daily_streak = MAX(best_daily_streak, ?), last_daily_day = ? WHERE id = ?',
    streak,
    streak,
    day,
    userId,
  );
  return { ...rankOf(day, score, timeMs), streak };
}

/** A streak only counts if it's still alive (played today or yesterday). */
export function liveDailyStreak(u: Pick<UserRow, 'daily_streak' | 'last_daily_day'>) {
  const today = dayKey();
  return u.last_daily_day === today || u.last_daily_day === shiftDay(today, -1) ? u.daily_streak : 0;
}

export function dailyInfo(userId: number): DailyInfo {
  const day = dayKey();
  const mine = one<{ finished_at: number | null; score: number | null; correct: number | null; time_ms: number | null }>(
    'SELECT finished_at, score, correct, time_ms FROM daily_results WHERE user_id = ? AND day = ?',
    userId,
    day,
  );
  const rows = all<UserRow & { score: number; correct: number }>(
    `SELECT u.*, d.score, d.correct FROM daily_results d JOIN users u ON u.id = d.user_id
     WHERE d.day = ? AND d.finished_at IS NOT NULL ORDER BY d.score DESC, d.time_ms ASC LIMIT 50`,
    day,
  );
  const played = mine?.finished_at ? { score: mine.score!, correct: mine.correct!, ...rankOf(day, mine.score!, mine.time_ms!) } : null;
  return {
    day,
    endsAt: dayEndsAt(day),
    streak: liveDailyStreak(getUser(userId)!),
    attempted: !!mine,
    played: played && { score: played.score, correct: played.correct, rank: played.rank },
    total: rankOf(day, 0, 0).total,
    entries: rows.map((r, i) => ({ rank: i + 1, user: toPublicUser(r), value: r.score, correct: r.correct })),
  };
}
