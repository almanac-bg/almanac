import { setImmediate as yieldToMatches } from 'node:timers/promises';
import { CROWD, type Crowd, type Difficulty, type PlayCheck } from '@quiz/shared';
import { all, one, run, tx } from './db';
import type { AnswerLogEntry } from './game/Game';
import { questionInfo } from './questionReports';
import { bankOption, isChoice, type PreparedQuestion, questionById } from './questions';
import { accurateAnswerers, tallyAnswer } from './tallies';
import { getUser, toPublicUser } from './users';

/** How long each person's answers are kept: enough to see a pattern, not a history of everything they ever played. */
export const ANSWER_LOG_DAYS = 90;

/**
 * Saves a person's answers from a match, and adds them to each question's totals: right or not, and on a question with
 * options which one was picked (as the bank orders them). Call inside the match's transaction.
 */
export function recordAnswers(matchId: string, userId: number, log: AnswerLogEntry[], at = Date.now()) {
  for (const a of log) {
    run(
      `INSERT INTO answers (user_id, match_id, question_id, difficulty, correct, time_ms, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      userId,
      matchId,
      a.questionId,
      a.difficulty,
      a.correct ? 1 : 0,
      a.timeMs,
      at,
    );
    tallyAnswer(userId, a.difficulty, a.correct, at);
    run(
      `INSERT INTO question_stats (question_id, answered, correct, correct_ms) VALUES (?, 1, ?, ?)
       ON CONFLICT (question_id) DO UPDATE SET answered = answered + 1, correct = correct + excluded.correct,
         correct_ms = correct_ms + excluded.correct_ms`,
      a.questionId,
      a.correct ? 1 : 0,
      a.correct ? (a.timeMs ?? 0) : 0,
    );
    // A number or an order has no option to count.
    if (a.closeness !== null || a.placed !== null) continue;
    // Column names from a fixed list, never from the answer itself.
    const column = a.choice === null ? 'unanswered' : PICK_COLUMNS[a.choice];
    if (column) run(`UPDATE question_stats SET ${column} = ${column} + 1 WHERE question_id = ?`, a.questionId);
  }
}

const PICK_COLUMNS = ['pick0', 'pick1', 'pick2', 'pick3'] as const;

interface StatsRow {
  answered: number;
  correct: number;
  pick0: number;
  pick1: number;
  pick2: number;
  pick3: number;
  unanswered: number;
}

/**
 * How everyone who played this question before answered it, in this match's option order: „62% знаят“ at the reveal,
 * each option's share in the review. Null until CROWD.minAnswers have (a handful says more about who played than
 * about the question), or for a question changed since it was drawn.
 */
export function crowdFor(q: PreparedQuestion): Crowd | null {
  const r = one<StatsRow>('SELECT * FROM question_stats WHERE question_id = ?', q.id);
  if (!r) return null;
  // A number is right once it's close, an order once all of it is: that share is the only one there is.
  if (!isChoice(q))
    return r.answered >= CROWD.minAnswers ? { known: r.correct / r.answered, picks: null, answers: r.answered } : null;
  const bank = [r.pick0, r.pick1, r.pick2, r.pick3];
  const answers = bank.reduce((sum, n) => sum + n, 0) + r.unanswered;
  const right = bankOption(q, q.answer);
  if (answers < CROWD.minAnswers || right === null) return null;
  const picks = q.options.map((_, shown) => {
    const i = bankOption(q, shown);
    return i === null ? 0 : bank[i] / answers;
  });
  return { known: bank[right] / answers, picks, answers };
}

/** Answers dropped in one delete: a short one, so the matches going on don't wait on it. */
const PRUNE_BATCH = 5_000;
/** At most this many batches a run, the matches getting their turn between them (about a million answers). */
const PRUNE_BATCHES = 200;

/**
 * Drops answers older than ANSWER_LOG_DAYS (the totals per question stay), batch after batch until none are left: a
 * fixed amount per run would fall behind once enough people play, and the table would grow without end. Returns how
 * many went.
 */
export async function pruneAnswers(now = Date.now()): Promise<number> {
  const before = now - ANSWER_LOG_DAYS * 24 * 60 * 60_000;
  let pruned = 0;
  for (let i = 0; i < PRUNE_BATCHES; i++) {
    // The same rows twice in one transaction (the index's order): what leaves the log leaves the tallies.
    const batch = 'SELECT rowid FROM answers WHERE answered_at < ? ORDER BY answered_at, rowid LIMIT ?';
    const { changes } = tx(() => {
      run(
        `UPDATE answer_tallies SET answered = answered - g.n, correct = correct - g.hits
         FROM (SELECT user_id, COUNT(*) AS n, SUM(correct) AS hits FROM answers
           WHERE rowid IN (${batch}) AND difficulty <> 'easy' GROUP BY user_id) AS g
         WHERE answer_tallies.user_id = g.user_id`,
        before,
        PRUNE_BATCH,
      );
      return run(`DELETE FROM answers WHERE rowid IN (${batch})`, before, PRUNE_BATCH);
    });
    pruned += Number(changes);
    if (Number(changes) < PRUNE_BATCH) break;
    await yieldToMatches();
  }
  return pruned;
}

/**
 * Who answers medium and hard questions right nearly always, and fast: what a script reading the answers off a copy of
 * the bank looks like. A strong player misses some hard ones and needs a moment to read; this is for a moderator to
 * look at, never an automatic ban.
 */
export const SUSPICIOUS = { minAnswers: 40, minAccuracy: 0.95, maxMedianMs: 2_500 } as const;

function suspiciousPlayers(limit = 50): PlayCheck['suspicious'] {
  const rows = accurateAnswerers(SUSPICIOUS.minAnswers, SUSPICIOUS.minAccuracy, limit * 4);
  const flagged: PlayCheck['suspicious'] = [];
  for (const r of rows) {
    const times = all<{ t: number }>(
      `SELECT time_ms AS t FROM answers WHERE user_id = ? AND difficulty <> 'easy' AND correct = 1 AND time_ms IS NOT NULL
       ORDER BY time_ms`,
      r.user_id,
    ).map((x) => x.t);
    const median = times[Math.floor(times.length / 2)] ?? Infinity;
    const user = getUser(r.user_id);
    if (median > SUSPICIOUS.maxMedianMs || !user) continue;
    flagged.push({
      user: { ...toPublicUser(user), bannedUntil: user.banned_until },
      answers: r.n,
      accuracy: r.hits / r.n,
      medianCorrectMs: median,
      lastAt: r.last_at,
    });
    if (flagged.length >= limit) break;
  }
  return flagged;
}

/** Answers a question needs before its numbers say anything. */
export const CALIBRATION_MIN_ANSWERS = 30;

/** The share of people who get a question right that its difficulty should land in (what the bank's labels promise). */
export const EXPECTED_CORRECT: Record<Difficulty, [number, number]> = {
  easy: [0.6, 1],
  medium: [0.35, 0.85],
  hard: [0, 0.6],
};

/** Below this, so few get it right that the marked answer may be the wrong one. */
export const LIKELY_WRONG_BELOW = 0.15;

/** Questions with enough answers whose numbers disagree with their label, the most likely mistakes first. */
function questionsToCheck(): PlayCheck['questions'] {
  const rows = all<{ question_id: string; answered: number; correct: number; correct_ms: number }>(
    'SELECT * FROM question_stats WHERE answered >= ? ORDER BY correct * 1.0 / answered',
    CALIBRATION_MIN_ANSWERS,
  );
  const out: PlayCheck['questions'] = [];
  for (const r of rows) {
    const q = questionById(r.question_id);
    // A number counts as right once it's close, an order once all of it is: their share says nothing about the label
    // the way a pick does.
    if (!q || !isChoice(q)) continue;
    const share = r.correct / r.answered;
    const [low, high] = EXPECTED_CORRECT[q.difficulty];
    const verdict = share < LIKELY_WRONG_BELOW ? 'wrong' : share < low ? 'harder' : share > high ? 'easier' : null;
    if (!verdict) continue;
    out.push({
      question: questionInfo(q),
      verdict,
      answered: r.answered,
      correctShare: share,
      avgCorrectMs: r.correct ? Math.round(r.correct_ms / r.correct) : null,
    });
  }
  const order = { wrong: 0, harder: 1, easier: 2 };
  return out.sort((a, b) => order[a.verdict] - order[b.verdict]).slice(0, 100);
}

export function playCheck(): PlayCheck {
  return {
    suspicious: suspiciousPlayers(),
    questions: questionsToCheck(),
    rules: {
      minAnswers: SUSPICIOUS.minAnswers,
      minAccuracy: SUSPICIOUS.minAccuracy,
      maxMedianMs: SUSPICIOUS.maxMedianMs,
      questionMinAnswers: CALIBRATION_MIN_ANSWERS,
      logDays: ANSWER_LOG_DAYS,
    },
  };
}
