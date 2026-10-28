import {
  QUESTION_REPORT_REASONS,
  type QuestionInfo,
  type QuestionReportAction,
  type QuestionReportGroup,
  type QuestionReportReason,
} from '@quiz/shared';
import { redrawDailyWithout } from './daily';
import { all, one, run, tx } from './db';
import { type PlayableQuestion, questionById, reloadQuestionBank } from './questions';

type Result = { ok: true } | { ok: false; error: string };

const REASONS = new Set<string>(QUESTION_REPORT_REASONS.map((r) => r.id));
const isHidden = (id: string) => !!one('SELECT 1 AS x FROM hidden_questions WHERE question_id = ?', id);

export function questionInfo(q: PlayableQuestion): QuestionInfo {
  const number = q.kind === 'number' ? q.number : null;
  return {
    id: q.id,
    category: q.category,
    difficulty: q.difficulty,
    q: q.q,
    options: q.kind === 'number' ? [] : q.options,
    answer: q.kind === 'number' ? -1 : q.answer,
    number: number && { answer: number.answer, unit: number.unit },
    author: (q.kind !== 'number' && q.author) || null,
    hidden: isHidden(q.id),
    fact: q.fact ?? null,
    factSource: q.factSource ?? null,
  };
}

/** A player flags a mistake. Repeating it while the first report is open just updates it. */
export function reportQuestion(userId: number, questionId: string, reason: string, details: string): Result {
  if (!questionById(questionId)) return { ok: false, error: 'Няма такъв въпрос.' };
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

/** Closes a question's open reports; `hide` also takes it out of new matches right away. */
export function resolveQuestionReports(adminId: number, questionId: string, action: QuestionReportAction): Result {
  if (!questionById(questionId)) return { ok: false, error: 'Няма такъв въпрос.' };
  tx(() => {
    if (action === 'hide') {
      run(
        'INSERT OR IGNORE INTO hidden_questions (question_id, hidden_by, hidden_at) VALUES (?, ?, ?)',
        questionId,
        adminId,
        Date.now(),
      );
    }
    run(
      "UPDATE question_reports SET status = 'resolved', resolved_at = ?, resolved_by = ? WHERE question_id = ? AND status = 'open'",
      Date.now(),
      adminId,
      questionId,
    );
  });
  if (action === 'hide') {
    reloadQuestionBank();
    redrawDailyWithout(questionId);
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

export function unhideQuestion(questionId: string): Result {
  if (!Number(run('DELETE FROM hidden_questions WHERE question_id = ?', questionId).changes)) {
    return { ok: false, error: 'Въпросът не е скрит.' };
  }
  reloadQuestionBank();
  return { ok: true };
}
