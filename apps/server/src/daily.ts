import { randomBytes } from 'node:crypto';
import {
  DAILY_FIELD,
  type DailyField,
  type DailyInfo,
  type DailyPreview,
  type DailySharer,
  dayEndsAt,
  dayKey,
  dayNumber,
  daysBetween,
  MODES,
  STREAK_SHIELDS,
  weekStart,
} from '@quiz/shared';
import { config } from './config';
import { all, one, run } from './db';
import { friendIds } from './friends';
import { notify } from './notifications';
import {
  holdBackDaily,
  imageBank,
  numberBank,
  orderBank,
  type PreparedQuestion,
  pickMatch,
  questionBank,
  reorderOptions,
  seededRng,
  withoutAuthors,
} from './questions';
import { installationSecret } from './settings';
import { count } from './stats';
import { onDailyBoard } from './trust';
import { getUser, NOT_BANNED, toPublicUser, type UserRow } from './users';

/**
 * On the day's board: a run that isn't kept off it (`own_set`: a guest's, or an account's made that day; from older
 * code, a guest's), by a player who isn't banned.
 */
const ON_BOARD = `COALESCE(d.own_set, u.is_guest) = 0 AND ${NOT_BANNED}`;

// Held back from every other match until midnight (questions.ts → recentFor): drawn now if nobody has opened the day
// yet, so a Соло at 00:01 can't take one of them first.
let held = { day: '', ids: [] as string[] };
holdBackDaily(() => {
  const day = dayKey();
  if (held.day !== day) held = { day, ids: dailySet(day).map((q) => q.id) };
  return held.ids;
});

/**
 * Today's question set: drawn once a day, then frozen in the database. Questions with a "Знаеше ли?" fact come first,
 * and of those the ones played least so far: the day everyone plays shouldn't be what the regulars have seen most. The
 * tenth is a number final.
 */
function dailySet(day: string): PreparedQuestion[] {
  const existing = one<{ questions: string }>('SELECT questions FROM daily_sets WHERE day = ?', day);
  if (existing) return JSON.parse(existing.questions);
  const played = new Map(
    all<{ question_id: string; answered: number }>('SELECT question_id, answered FROM question_stats').map((r) => [
      r.question_id,
      r.answered,
    ]),
  );
  // The picks take the lowest first.
  const order = new Map(
    [...questionBank(), ...imageBank(), ...numberBank(), ...orderBank()].map((q) => [
      q.id,
      (q.fact ? 0 : 1_000_000) + (played.get(q.id) ?? 0),
    ]),
  );
  // The seed includes this installation's secret: with the code public, a date alone mustn't reveal the questions.
  const questions = pickMatch(MODES.daily.questions, 'mixed', order, {
    final: MODES.daily.final,
    // A picture every day; „Подреди“ on Mondays.
    formats: { ...MODES.daily.formats, order: weekStart(day) === day },
    rng: seededRng(`daily:${installationSecret('daily-seed')}:${day}`),
  });
  run(
    'INSERT OR IGNORE INTO daily_sets (day, questions) VALUES (?, ?)',
    day,
    JSON.stringify(withoutAuthors(questions)),
  );
  return JSON.parse(one<{ questions: string }>('SELECT questions FROM daily_sets WHERE day = ?', day)!.questions);
}

/**
 * A question was just hidden (a moderator found it wrong): if it's in the day's set and nobody has started it yet, the
 * set is drawn again without it. Once anyone has played, the set stands — the board compares the same ten questions
 * for everyone.
 */
export function redrawDailyWithout(questionId: string, day = dayKey()): boolean {
  const set = one<{ questions: string }>('SELECT questions FROM daily_sets WHERE day = ?', day);
  if (!set || !(JSON.parse(set.questions) as PreparedQuestion[]).some((q) => q.id === questionId)) return false;
  const started = one('SELECT 1 AS x FROM daily_results WHERE day = ? LIMIT 1', day);
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
 * A guest just saved their profile. Made before today, the account is on the day's board from now on, and so is the
 * run it played today. Made today, that run stays off the board, and the account joins it tomorrow (onDailyBoard).
 */
export function joinBoardAfterSave(userId: number) {
  const user = getUser(userId);
  if (!user || !onDailyBoard(user)) return;
  run('UPDATE daily_results SET own_set = 0 WHERE user_id = ? AND day = ?', userId, dayKey());
}

/**
 * Claims today's single attempt. Starting counts — leaving or disconnecting doesn't give a retry; only a server restart
 * that cut the attempt short before any of its answers was revealed does. Once one was, the run ends with the score
 * saved at its last reveal.
 */
export function claimDailyAttempt(
  userId: number,
  viaCode: string | null = null,
): { ok: true; day: string } | { ok: false; error: string } {
  const day = dayKey();
  const existing = one<{ started_at: number; finished_at: number | null; revealed: number }>(
    'SELECT started_at, finished_at, revealed FROM daily_results WHERE user_id = ? AND day = ?',
    userId,
    day,
  );
  if (existing && !existing.finished_at && existing.started_at < config.bootedAt && existing.revealed > 0) {
    run('UPDATE daily_results SET finished_at = ? WHERE user_id = ? AND day = ?', Date.now(), userId, day);
    return { ok: false, error: cutShortError(existing.revealed) };
  }
  if (existing && !existing.finished_at && existing.started_at < config.bootedAt) {
    run('UPDATE daily_results SET started_at = ? WHERE user_id = ? AND day = ?', Date.now(), userId, day);
    return { ok: true, day };
  }
  if (existing) {
    return {
      ok: false,
      error: existing.finished_at
        ? 'Вече изигра днешните въпроси. Нови има утре!'
        : 'Днешният опит вече е започнат — имаш само един на ден.',
    };
  }
  const offBoard = !onDailyBoard(getUser(userId)!, day);
  // Opened from someone's link for today: they hear how it went (tellSharer).
  const link = viaCode
    ? one<{ user_id: number }>('SELECT user_id FROM daily_links WHERE code = ? AND day = ?', viaCode, day)
    : undefined;
  run(
    'INSERT INTO daily_results (user_id, day, started_at, own_set, via) VALUES (?, ?, ?, ?, ?)',
    userId,
    day,
    Date.now(),
    offBoard ? 1 : 0,
    link && link.user_id !== userId ? link.user_id : null,
  );
  count('daily_runs');
  if (link && link.user_id !== userId) count('link_uses:daily');
  return { ok: true, day };
}

/** Said when a run cut short after some of its answers were revealed is asked for again. */
export const cutShortError = (revealed: number) =>
  `Опитът ти прекъсна при нас след ${revealed} ${revealed === 1 ? 'въпрос' : 'въпроса'} — резултатът дотук е записан.`;

/** Saved at each reveal of a daily run: what stands if the run is cut short from here on. */
export function saveDailyProgress(
  userId: number,
  day: string,
  revealed: number,
  score: number,
  correct: number,
  timeMs: number,
) {
  run(
    `UPDATE daily_results SET revealed = ?, score = ?, correct = ?, time_ms = ?
     WHERE user_id = ? AND day = ? AND finished_at IS NULL`,
    revealed,
    score,
    correct,
    timeMs,
    userId,
    day,
  );
}

/**
 * A run that ended without its result (cut short by us, or the result couldn't be saved). With none of its answers
 * revealed the day's one attempt is the player's again; once one was, the run stands with the score saved at its last
 * reveal, since a replay would come knowing answers.
 */
export function releaseDailyAttempt(userId: number, day: string) {
  run(
    'UPDATE daily_results SET finished_at = ? WHERE user_id = ? AND day = ? AND finished_at IS NULL AND revealed > 0',
    Date.now(),
    userId,
    day,
  );
  run('DELETE FROM daily_results WHERE user_id = ? AND day = ? AND finished_at IS NULL', userId, day);
}

/** How many are on the day's board. */
const boardSize = (day: string) =>
  one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM daily_results d JOIN users u ON u.id = d.user_id
     WHERE d.day = ? AND d.finished_at IS NOT NULL AND ${ON_BOARD}`,
    day,
  )!.n;

/** Place on the day's board, and how many are on it. For a run off the board: where it would stand on it. */
function rankOf(day: string, score: number, timeMs: number): { rank: number; total: number } {
  const better = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM daily_results d JOIN users u ON u.id = d.user_id
     WHERE d.day = ? AND d.finished_at IS NOT NULL AND ${ON_BOARD}
     AND (d.score > ? OR (d.score = ? AND d.time_ms < ?))`,
    day,
    score,
    score,
    timeMs,
  )!.n;
  return { rank: better + 1, total: boardSize(day) };
}

/**
 * How the day went for everyone on its board, once DAILY_FIELD.minPlayers are on it: right answers run by run, and the
 * share of the others this run did better than (`onBoard`: it's one of them). Null until then.
 */
function dayField(day: string, score: number, timeMs: number, onBoard: boolean): DailyField | null {
  const rows = all<{ correct: number; n: number }>(
    `SELECT d.correct, COUNT(*) AS n FROM daily_results d JOIN users u ON u.id = d.user_id
     WHERE d.day = ? AND d.finished_at IS NOT NULL AND ${ON_BOARD} GROUP BY d.correct`,
    day,
  );
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  if (total < DAILY_FIELD.minPlayers) return null;
  const histogram = Array<number>(MODES.daily.questions + 1).fill(0);
  for (const r of rows) histogram[Math.min(Math.max(r.correct, 0), MODES.daily.questions)] += r.n;
  const worse = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM daily_results d JOIN users u ON u.id = d.user_id
     WHERE d.day = ? AND d.finished_at IS NOT NULL AND ${ON_BOARD}
     AND (d.score < ? OR (d.score = ? AND d.time_ms > ?))`,
    day,
    score,
    score,
    timeMs,
  )!.n;
  const others = onBoard ? total - 1 : total;
  return { beaten: others > 0 ? worse / others : 0, histogram };
}

/** A sharer's result on the day, as the people they sent the link to see it. */
function sharerResult(userId: number, day: string): DailySharer | null {
  const r = one<UserRow & { score: number; correct: number }>(
    `SELECT u.*, d.score, d.correct FROM daily_results d JOIN users u ON u.id = d.user_id
     WHERE d.user_id = ? AND d.day = ? AND d.finished_at IS NOT NULL AND ${NOT_BANNED}`,
    userId,
    day,
  );
  return r
    ? { user: { username: r.username, avatar: r.avatar, frame: r.frame }, score: r.score, correct: r.correct }
    : null;
}

/** Whoever shared the link hears how it went: one note a day, saying how many have played it so far. */
function tellSharer(sharerId: number, player: UserRow, day: string, correct: number) {
  const of = MODES.daily.questions;
  const theirs = one<{ correct: number }>(
    'SELECT correct FROM daily_results WHERE user_id = ? AND day = ? AND finished_at IS NOT NULL',
    sharerId,
    day,
  );
  const played = one<{ n: number }>(
    'SELECT COUNT(*) AS n FROM daily_results WHERE via = ? AND day = ? AND finished_at IS NOT NULL',
    sharerId,
    day,
  )!.n;
  const yours = theirs ? ` Ти: ${theirs.correct}/${of}.` : '';
  notify(sharerId, {
    icon: '📅',
    text:
      played > 1
        ? `${played} души изиграха днешните въпроси по твоя линк (последно — ${player.username}: ${correct}/${of}).${yours}`
        : `${player.username} изигра днешните въпроси по твоя линк: ${correct}/${of}.${yours}`,
    link: '/daily',
    replace: true,
  });
}

/**
 * The player's link to today's questions (/daily/<code>), made the first time they share it. Only once they've played
 * today: by then they know the answers, so the link gives away nothing they couldn't tell a friend anyway.
 */
export function dailyLink(userId: number): string | null {
  const day = dayKey();
  if (!one('SELECT 1 AS x FROM daily_results WHERE user_id = ? AND day = ? AND finished_at IS NOT NULL', userId, day))
    return null;
  const existing = one<{ code: string }>('SELECT code FROM daily_links WHERE user_id = ? AND day = ?', userId, day);
  if (existing) return existing.code;
  const code = randomBytes(6).toString('base64url');
  run('INSERT INTO daily_links (code, user_id, day, created_at) VALUES (?, ?, ?, ?)', code, userId, day, Date.now());
  return code;
}

/** Today's questions as a link shows them, signed in or not: whose link it is and how they did. */
export function dailyPreview(code: string | null): DailyPreview {
  const day = dayKey();
  const link = code
    ? one<{ user_id: number }>('SELECT user_id FROM daily_links WHERE code = ? AND day = ?', code, day)
    : undefined;
  return {
    day,
    number: dayNumber(day),
    sharer: link ? sharerResult(link.user_id, day) : null,
    players: boardSize(day),
  };
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
  if (played) count('daily_finished');
  const u = getUser(userId)!;
  const entry = one<{ own_set: number | null; via: number | null }>(
    'SELECT own_set, via FROM daily_results WHERE user_id = ? AND day = ?',
    userId,
    day,
  );
  if (entry?.via) tellSharer(entry.via, u, day, correct);
  const offBoard = (entry?.own_set ?? u.is_guest) === 1;
  const rank = {
    ...rankOf(day, score, timeMs),
    offBoard,
    sharer: entry?.via ? sharerResult(entry.via, day) : null,
    field: dayField(day, score, timeMs, !offBoard),
  };
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
     WHERE d.day = ? AND d.finished_at IS NOT NULL AND ${ON_BOARD} AND d.user_id IN (${ids.map(() => '?').join(', ')})
     ORDER BY d.score DESC, d.time_ms ASC`,
    day,
    ...ids,
  );
  return rows.map((r, i) => ({ rank: i + 1, user: toPublicUser(r), value: r.score, correct: r.correct }));
}

/** Who played today's questions from this player's link, best first. */
function fromLink(userId: number, day: string) {
  return all<UserRow & { score: number; correct: number }>(
    `SELECT u.*, d.score, d.correct FROM daily_results d JOIN users u ON u.id = d.user_id
     WHERE d.via = ? AND d.day = ? AND d.finished_at IS NOT NULL AND ${NOT_BANNED}
     ORDER BY d.score DESC, d.time_ms ASC LIMIT 50`,
    userId,
    day,
  ).map((r) => ({ user: toPublicUser(r), score: r.score, correct: r.correct }));
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
     WHERE d.day = ? AND d.finished_at IS NOT NULL AND ${ON_BOARD} ORDER BY d.score DESC, d.time_ms ASC LIMIT 50`,
    day,
  );
  const me = getUser(userId)!;
  const guest = me.is_guest === 1;
  // Today's run as it was started; one not started yet goes by the account as it is now.
  const offBoard = mine ? (mine.own_set ?? me.is_guest) === 1 : !onDailyBoard(me, day);
  const played = mine?.finished_at
    ? {
        score: mine.score!,
        correct: mine.correct!,
        rank: rankOf(day, mine.score!, mine.time_ms!).rank,
        field: dayField(day, mine.score!, mine.time_ms!, !offBoard),
      }
    : null;
  return {
    day,
    number: dayNumber(day),
    endsAt: dayEndsAt(day),
    streak: liveDailyStreak(me),
    attempted: !!mine,
    offBoard,
    played,
    total: boardSize(day),
    entries: rows.map((r, i) => ({ rank: i + 1, user: toPublicUser(r), value: r.score, correct: r.correct })),
    friends: guest ? [] : friendsToday(day, userId),
    fromMyLink: fromLink(userId, day),
  };
}
