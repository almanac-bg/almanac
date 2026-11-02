import {
  MODERATION,
  type ModerationBasis,
  QUESTION_REPORT_REASONS,
  type QuestionInfo,
  type QuestionReportAction,
  type QuestionReportGroup,
  type QuestionReportReason,
  RATED_AFTER,
} from '@quiz/shared';
import { alertModerators } from './alerts';
import { redrawDailyWithout } from './daily';
import { all, one, run, tx } from './db';
import { logAction, OWN_QUESTION, questionAuthor } from './modlog';
import { notify } from './notifications';
import {
  dropFromPlay,
  imageCredit,
  isChoice,
  type PlayableQuestion,
  questionById,
  questionImage,
  reloadQuestionBank,
  rightOrderOf,
} from './questions';
import { sentence, tellPlayer, tellReversal } from './statements';

type Result = { ok: true } | { ok: false; error: string };

const REASONS = new Set<string>(QUESTION_REPORT_REASONS.map((r) => r.id));
const isHidden = (id: string) => !!one('SELECT 1 AS x FROM hidden_questions WHERE question_id = ?', id);

/** A player's question as its author's messages name it; null for the bank's own (no author to tell). */
function authored(questionId: string): { authorId: number; text: string } | null {
  const row = one<{ author_id: number | null; q: string }>(
    'SELECT author_id, q FROM questions WHERE id = ?',
    questionId,
  );
  if (!row?.author_id) return null;
  return { authorId: row.author_id, text: row.q.length > 70 ? `${row.q.slice(0, 70)}…` : row.q };
}

/** What a moderator says when hiding a player's question (a set's hide asks the same): basis and reason. */
export interface HideGrounds {
  basis: ModerationBasis | null;
  reason: string;
  /** An approval taken back, rather than a hide. */
  withdrawn?: boolean;
}

/**
 * A player's question taken out of play: its author gets the statement of reasons every content decision gives
 * (statements.ts, by note and mail; the 31 October review, MOD-5 = LEGAL-4). By its players' flags (`adminId` null),
 * it says it was decided automatically until a person checks, with what they flagged.
 */
function tellHidden(questionId: string, adminId: number | null, grounds?: HideGrounds) {
  const q = authored(questionId);
  if (!q) return;
  const flagged = all<{ reason: string }>(
    'SELECT DISTINCT reason FROM question_reports WHERE question_id = ? AND created_at > ?',
    questionId,
    Date.now() - 30 * 24 * 60 * 60_000,
  ).map((r) => QUESTION_REPORT_REASONS.find((x) => x.id === r.reason)?.label ?? r.reason);
  const flags = flagged.length ? `Сигнали: ${flagged.join('; ')}` : '';
  tellPlayer(q.authorId, {
    what:
      adminId === null
        ? `Сигналите на играчите скриха въпроса ти „${q.text}“ от новите мачове, докато модератор го провери.`
        : grounds?.withdrawn
          ? `Модератор оттегли одобрението на въпроса ти „${q.text}“: вече не е в играта.`
          : `Модератор скри въпроса ти „${q.text}“ от новите мачове.`,
    basis: grounds?.basis ?? null,
    // The moderator's words, and what the players flagged (the facts it rests on).
    reason: [grounds?.reason && sentence(grounds.reason), flags].filter(Boolean).join(' ') || 'Проверка от модератор',
    onReport: flagged.length > 0,
    automated:
      adminId === null
        ? 'Решено е автоматично, от сигналите на играчите (без човек), докато модератор го провери.'
        : undefined,
    subject: 'Въпросът ти е скрит от новите мачове',
    icon: '🚩',
    link: '/submit',
  });
}

/** A player's question back in play: its author hears so, and why. */
function tellShown(questionId: string, reason: string) {
  const q = authored(questionId);
  if (q) tellReversal(q.authorId, `Въпросът ти „${q.text}“ отново е в играта.`, reason, '✅', '/submit');
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
 * A player flags a mistake. Repeating it while the first report is open just updates it. Enough flags that count
 * (MODERATION.autoHideFlags) take the question out of new matches until a moderator looks: a wrong answer taught to
 * everyone is worse than a good question missed for a day. Every flag waits in „Сигнали“; only those from players who
 * were shown the question and rate others count, never again ones a moderator dismissed, and at most
 * MODERATION.autoHidesPerDay hides a day — a few accounts must not be able to strip the bank.
 */
export function reportQuestion(userId: number, questionId: string, reason: string, details: string): Result {
  const q = questionById(questionId);
  if (!q) return { ok: false, error: 'Няма такъв въпрос.' };
  if (!REASONS.has(reason)) return { ok: false, error: 'Избери причина.' };
  const now = Date.now();
  run(
    `INSERT INTO question_reports (question_id, user_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (question_id, user_id) WHERE status = 'open' DO UPDATE SET reason = excluded.reason, details = excluded.details`,
    questionId,
    userId,
    reason,
    details.trim().slice(0, 500),
    now,
  );
  const flags = one<{ all: number; counted: number }>(
    `SELECT COUNT(*) AS "all", SUM(u.is_guest = 0 AND u.created_at <= ? AND u.games_played >= ?
       AND EXISTS (SELECT 1 FROM seen_questions s WHERE s.user_id = r.user_id AND s.question_id = r.question_id)
       AND NOT EXISTS (SELECT 1 FROM question_reports d
                       WHERE d.question_id = r.question_id AND d.user_id = r.user_id AND d.status = 'dismissed')) AS counted
     FROM question_reports r JOIN users u ON u.id = r.user_id
     WHERE r.question_id = ? AND r.status = 'open'`,
    now - RATED_AFTER.ms,
    RATED_AFTER.games,
    questionId,
  )!;
  const counted = flags.counted ?? 0;
  if (counted < MODERATION.autoHideFlags || isHidden(questionId)) {
    if (counted >= MODERATION.alertAt) alertFlags();
    return { ok: true };
  }
  // Counted from the log, where a hide stays when a moderator puts the question back: an unhide frees no slot (the 31
  // October review, MOD-2).
  const hiddenToday = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM moderation_log WHERE created_at > ? AND action = 'auto_hide_question'",
    now - 24 * 60 * 60_000,
  )!.n;
  if (hiddenToday >= MODERATION.autoHidesPerDay) {
    alertFlags();
    return { ok: true };
  }
  hideQuestion(null, questionId);
  // One mail a day for these, whatever their number (the morning summary lists the rest).
  alertModerators('questions-auto-hidden', 'Въпроси, скрити от сигналите на играчите', [
    `Първият днес: ${questionId} — „${q.q}“.`,
    'Скрити са от новите мачове, докато някой ги провери (в „Сигнали“; в „Дневник“ — отмяна).',
  ]);
  return { ok: true };
}

/** Flags waiting on questions: one mail a day, however many questions (a flood of flags must not flood the inbox). */
const alertFlags = () =>
  alertModerators('question-flags', 'Сигнали за въпроси чакат проверка', [
    `Въпроси със сигнали: ${openQuestionReportCount()}.`,
  ]);

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

/**
 * Takes a question out of new matches (`adminId` null: its players' flags did), logged so it can be undone, with the
 * moderator's grounds (asked for a player's question).
 */
export function hideQuestion(adminId: number | null, questionId: string, grounds?: HideGrounds) {
  run(
    'INSERT OR IGNORE INTO hidden_questions (question_id, hidden_by, hidden_at) VALUES (?, ?, ?)',
    questionId,
    adminId,
    Date.now(),
  );
  logAction({
    adminId,
    action: adminId === null ? 'auto_hide_question' : 'hide_question',
    userId: questionAuthor(questionId),
    target: questionId,
    basis: grounds?.basis ?? null,
    reason: grounds?.reason || null,
    undo: {},
  });
  dropFromPlay(questionId);
  redrawDailyWithout(questionId);
  tellHidden(questionId, adminId, grounds);
}

/**
 * Closes a question's open reports: `dismiss` (nothing wrong), `hide` (out of new matches), or `fixed` (it was
 * corrected: what players did on the old wording no longer says anything about it, so its numbers start over, and
 * whoever flagged it is thanked).
 */
export function resolveQuestionReports(
  adminId: number,
  questionId: string,
  action: QuestionReportAction,
  grounds?: HideGrounds,
): Result {
  if (!questionById(questionId)) return { ok: false, error: 'Няма такъв въпрос.' };
  const author = questionAuthor(questionId);
  if (action !== 'hide' && author === adminId) return { ok: false, error: OWN_QUESTION };
  // A player's question hidden: its author reads why, as for a set.
  if (action === 'hide' && author !== null && (!grounds?.basis || grounds.reason.trim().length < MODERATION.reasonMin))
    return {
      ok: false,
      error: `Избери основание и напиши причина (поне ${MODERATION.reasonMin} знака): авторът ще ги прочете.`,
    };
  const open = all<{ id: number; user_id: number }>(
    "SELECT id, user_id FROM question_reports WHERE question_id = ? AND status = 'open'",
    questionId,
  );
  const reporters = open.map((r) => r.user_id);
  let shown = false;
  tx(() => {
    // Dismissed: those players' flags on this question never count toward hiding it again (reportQuestion).
    run(
      "UPDATE question_reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE question_id = ? AND status = 'open'",
      action === 'dismiss' ? 'dismissed' : 'resolved',
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
      logAction({ adminId, action: 'fix_question', userId: author, target: questionId });
    } else if (action === 'dismiss')
      // Which flags, and whether it was hidden: an undo opens them again and hides it again.
      logAction({
        adminId,
        action: 'dismiss_flags',
        userId: author,
        target: questionId,
        undo: { flags: open.map((r) => r.id), hidden: shown },
      });
  });
  if (action === 'hide') hideQuestion(adminId, questionId, grounds);
  else if (shown || action === 'fixed') reloadQuestionBank();
  if (shown)
    tellShown(
      questionId,
      action === 'fixed' ? 'Модератор го поправи.' : 'Модератор провери сигналите: въпросът е наред.',
    );
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

/**
 * A moderator puts a hidden question back: from the hidden list („Върни в играта“), or by undoing its hide in the log
 * (`undoing`). Either says the question is fine, so its open flags are dismissed as „Въпросът е наред“ dismisses them:
 * the same players can't hide it again with the next flag (the 31 October review, MOD-2). Which flags is logged, so
 * an undo opens them again: in the unhide's entry, or (undoing a hide) in a „Въпросът е наред“ entry of its own.
 */
export function unhideQuestion(
  questionId: string,
  adminId: number,
  { undoing = false, reason = 'Модератор го провери: въпросът е наред.' } = {},
): Result {
  const author = questionAuthor(questionId);
  if (author === adminId) return { ok: false, error: OWN_QUESTION };
  const flags = tx(() => {
    if (!Number(run('DELETE FROM hidden_questions WHERE question_id = ?', questionId).changes)) return null;
    const open = all<{ id: number }>(
      "SELECT id FROM question_reports WHERE question_id = ? AND status = 'open'",
      questionId,
    ).map((r) => r.id);
    run(
      "UPDATE question_reports SET status = 'dismissed', resolved_at = ?, resolved_by = ? WHERE question_id = ? AND status = 'open'",
      Date.now(),
      adminId,
      questionId,
    );
    if (!undoing)
      logAction({ adminId, action: 'unhide_question', userId: author, target: questionId, undo: { flags: open } });
    else if (open.length)
      logAction({
        adminId,
        action: 'dismiss_flags',
        userId: author,
        target: questionId,
        undo: { flags: open, hidden: true },
      });
    return open;
  });
  if (!flags) return { ok: false, error: 'Въпросът не е скрит.' };
  reloadQuestionBank();
  tellShown(questionId, reason);
  return { ok: true };
}

/**
 * Flags dismissed with a put-back (or „Въпросът е наред“), open again: its undo. A player who has flagged it again since
 * has an open flag already (one each): that one stands, and the dismissed one goes, so it counts again.
 */
export function reopenFlags(ids: number[]) {
  tx(() => {
    for (const id of ids) {
      run(
        `DELETE FROM question_reports AS d WHERE d.id = ? AND d.status = 'dismissed' AND EXISTS (
           SELECT 1 FROM question_reports o WHERE o.question_id = d.question_id AND o.user_id = d.user_id AND o.status = 'open')`,
        id,
      );
      run(
        "UPDATE question_reports SET status = 'open', resolved_at = NULL, resolved_by = NULL WHERE id = ? AND status = 'dismissed'",
        id,
      );
    }
  });
}
