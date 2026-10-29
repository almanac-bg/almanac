import {
  MODERATION,
  QUESTION_REPORT_REASONS,
  type QuestionInfo,
  type QuestionReportAction,
  type QuestionReportGroup,
  type QuestionReportReason,
} from '@quiz/shared';
import { alertModerators } from './alerts';
import { config } from './config';
import { redrawDailyWithout } from './daily';
import { all, one, run, tx } from './db';
import { logAction } from './modlog';
import { notify } from './notifications';
import {
  imageCredit,
  isChoice,
  type PlayableQuestion,
  questionById,
  questionImage,
  reloadQuestionBank,
  rightOrderOf,
} from './questions';

type Result = { ok: true } | { ok: false; error: string };

const REASONS = new Set<string>(QUESTION_REPORT_REASONS.map((r) => r.id));
const isHidden = (id: string) => !!one('SELECT 1 AS x FROM hidden_questions WHERE question_id = ?', id);

/**
 * A player's question taken out of play, or back in it: its author hears so, and why (what the players flagged in
 * the last month). The bank's questions have no author to tell.
 */
function tellAuthor(questionId: string, hidden: { byPlayers: boolean } | null) {
  const row = one<{ author_id: number | null; q: string }>(
    'SELECT author_id, q FROM questions WHERE id = ?',
    questionId,
  );
  if (!row?.author_id) return;
  const text = row.q.length > 70 ? `${row.q.slice(0, 70)}…` : row.q;
  if (!hidden) {
    notify(row.author_id, { icon: '✅', text: `Въпросът ти „${text}“ отново е в играта.`, link: '/submit' });
    return;
  }
  const flagged = all<{ reason: string }>(
    'SELECT DISTINCT reason FROM question_reports WHERE question_id = ? AND created_at > ?',
    questionId,
    Date.now() - 30 * 24 * 60 * 60_000,
  ).map((r) => QUESTION_REPORT_REASONS.find((x) => x.id === r.reason)?.label ?? r.reason);
  notify(row.author_id, {
    icon: '🚩',
    text: [
      hidden.byPlayers
        ? `Сигналите на играчите скриха въпроса ти „${text}“ от новите мачове, докато модератор го провери.`
        : `Модератор скри въпроса ти „${text}“ от новите мачове.`,
      flagged.length && `Сигнали: ${flagged.join('; ')}.`,
      `Ако смяташ, че е грешка, пиши на ${config.operator.email}.`,
    ]
      .filter(Boolean)
      .join(' '),
    link: '/submit',
  });
}

export function questionInfo(q: PlayableQuestion): QuestionInfo {
  const number = q.kind === 'number' ? q.number : null;
  const image = questionImage(q);
  const credit = imageCredit(q);
  return {
    id: q.id,
    category: q.category,
    difficulty: q.difficulty,
    q: q.q,
    options: isChoice(q) ? q.options : [],
    answer: isChoice(q) ? q.answer : -1,
    number: number && { answer: number.answer, unit: number.unit },
    order: q.kind === 'order' ? rightOrderOf(q) : null,
    image: image && credit && { ...image, ...credit },
    author: (isChoice(q) && q.author) || null,
    hidden: isHidden(q.id),
    fact: q.fact ?? null,
    factSource: q.factSource ?? null,
    answerSource: q.answerSource ?? null,
  };
}

/**
 * A player flags a mistake. Repeating it while the first report is open just updates it. Enough flags from players
 * with accounts older than a day (MODERATION) take the question out of new matches until a moderator looks: a wrong
 * answer taught to everyone is worse than a good question missed for a day.
 */
export function reportQuestion(userId: number, questionId: string, reason: string, details: string): Result {
  const q = questionById(questionId);
  if (!q) return { ok: false, error: 'Няма такъв въпрос.' };
  if (!REASONS.has(reason)) return { ok: false, error: 'Избери причина.' };
  run(
    `INSERT INTO question_reports (question_id, user_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (question_id, user_id) WHERE status = 'open' DO UPDATE SET reason = excluded.reason, details = excluded.details`,
    questionId,
    userId,
    reason,
    details.trim().slice(0, 500),
    Date.now(),
  );
  const flags = one<{ all: number; settled: number }>(
    `SELECT COUNT(*) AS "all", SUM(u.created_at < ?) AS settled FROM question_reports r JOIN users u ON u.id = r.user_id
     WHERE r.question_id = ? AND r.status = 'open'`,
    Date.now() - MODERATION.flaggerAgeDays * 24 * 60 * 60_000,
    questionId,
  )!;
  if ((flags.settled ?? 0) >= MODERATION.autoHideFlags && !isHidden(questionId)) {
    hideQuestion(null, questionId);
    alertModerators(`question:${questionId}`, `Въпрос, скрит от сигналите на играчите: ${questionId}`, [
      `„${q.q}“`,
      `${flags.all} сигнала. Скрит е от новите мачове, докато някой го провери (в „Сигнали“; в „Дневник“ — отмяна).`,
    ]);
  } else if (flags.all >= MODERATION.alertAt) {
    alertModerators(`question:${questionId}`, `${flags.all} сигнала за въпрос ${questionId}`, [`„${q.q}“`]);
  }
  return { ok: true };
}

export const openQuestionReportCount = () =>
  one<{ n: number }>("SELECT COUNT(DISTINCT question_id) AS n FROM question_reports WHERE status = 'open'")!.n;

/** Questions with open reports, the most reported first. */
export function openQuestionReports(): QuestionReportGroup[] {
  const rows = all<{
    id: number;
    question_id: string;
    reason: QuestionReportReason;
    details: string;
    created_at: number;
    reporter: string | null;
  }>(
    `SELECT r.id, r.question_id, r.reason, r.details, r.created_at, u.username AS reporter
     FROM question_reports r LEFT JOIN users u ON u.id = r.user_id
     WHERE r.status = 'open' ORDER BY r.created_at`,
  );
  const groups = new Map<string, QuestionReportGroup>();
  for (const r of rows) {
    const q = questionById(r.question_id);
    if (!q) continue; // a community question that no longer exists
    const group = groups.get(r.question_id) ?? { question: questionInfo(q), reports: [] };
    group.reports.push({
      id: r.id,
      reason: r.reason,
      details: r.details,
      createdAt: r.created_at,
      reporter: r.reporter,
    });
    groups.set(r.question_id, group);
  }
  return [...groups.values()].sort((a, b) => b.reports.length - a.reports.length);
}

/** Takes a question out of new matches (`adminId` null: its players' flags did), logged so it can be undone. */
export function hideQuestion(adminId: number | null, questionId: string) {
  run(
    'INSERT OR IGNORE INTO hidden_questions (question_id, hidden_by, hidden_at) VALUES (?, ?, ?)',
    questionId,
    adminId,
    Date.now(),
  );
  logAction({
    adminId,
    action: adminId === null ? 'auto_hide_question' : 'hide_question',
    target: questionId,
    undo: {},
  });
  reloadQuestionBank();
  redrawDailyWithout(questionId);
  tellAuthor(questionId, { byPlayers: adminId === null });
}

/**
 * Closes a question's open reports: `dismiss` (nothing wrong), `hide` (out of new matches), or `fixed` (it was
 * corrected: what players did on the old wording no longer says anything about it, so its numbers start over, and
 * whoever flagged it is thanked).
 */
export function resolveQuestionReports(adminId: number, questionId: string, action: QuestionReportAction): Result {
  if (!questionById(questionId)) return { ok: false, error: 'Няма такъв въпрос.' };
  const reporters = all<{ user_id: number }>(
    "SELECT user_id FROM question_reports WHERE question_id = ? AND status = 'open'",
    questionId,
  ).map((r) => r.user_id);
  let shown = false;
  tx(() => {
    run(
      "UPDATE question_reports SET status = 'resolved', resolved_at = ?, resolved_by = ? WHERE question_id = ? AND status = 'open'",
      Date.now(),
      adminId,
      questionId,
    );
    // Fixed, or the flags were wrong: back in play if they hid it.
    if (action !== 'hide')
      shown = Number(run('DELETE FROM hidden_questions WHERE question_id = ?', questionId).changes) > 0;
    if (action === 'fixed') {
      run('DELETE FROM question_stats WHERE question_id = ?', questionId);
      run('DELETE FROM question_skill WHERE question_id = ?', questionId);
      logAction({ adminId, action: 'fix_question', target: questionId });
    } else if (action === 'dismiss') logAction({ adminId, action: 'dismiss_flags', target: questionId });
  });
  if (action === 'hide') hideQuestion(adminId, questionId);
  else if (shown || action === 'fixed') reloadQuestionBank();
  if (shown) tellAuthor(questionId, null);
  if (action === 'fixed') {
    for (const userId of reporters)
      notify(userId, { icon: '🛠️', text: 'Благодарим! Въпросът, за който сигнализира, е поправен.' });
  }
  return { ok: true };
}

/** Hidden questions, newest first — so a hide can be undone. */
export function hiddenQuestions(): QuestionInfo[] {
  return all<{ question_id: string }>('SELECT question_id FROM hidden_questions ORDER BY hidden_at DESC')
    .map((r) => questionById(r.question_id))
    .filter((q): q is PlayableQuestion => !!q)
    .map(questionInfo);
}

export function unhideQuestion(questionId: string, adminId: number | null = null): Result {
  if (!Number(run('DELETE FROM hidden_questions WHERE question_id = ?', questionId).changes)) {
    return { ok: false, error: 'Въпросът не е скрит.' };
  }
  // From the hidden list (an undo from the log is logged as one already).
  if (adminId !== null) logAction({ adminId, action: 'unhide_question', target: questionId, undo: {} });
  reloadQuestionBank();
  tellAuthor(questionId, null);
  return { ok: true };
}
