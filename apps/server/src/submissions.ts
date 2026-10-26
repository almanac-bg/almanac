import {
  CATEGORY_IDS,
  type CategoryId,
  type Difficulty,
  levelFromXp,
  type QuestionDraft,
  SUBMISSION_RULES,
  type Submission,
  type SubmissionStatus,
} from '@quiz/shared';
import { z } from 'zod';
import { grantXp } from './account';
import { all, one, run, tx } from './db';
import { notify } from './notifications';
import { questionBank, reloadQuestionBank } from './questions';
import { getUser, toPublicUser, type UserRow } from './users';

const [qMin, qMax] = SUBMISSION_RULES.question;
const [oMin, oMax] = SUBMISSION_RULES.option;

export const DraftSchema = z
  .object({
    category: z.enum(CATEGORY_IDS as [CategoryId, ...CategoryId[]], { message: 'Избери категория.' }),
    difficulty: z.enum(['easy', 'medium', 'hard'], { message: 'Избери трудност.' }),
    q: z
      .string()
      .trim()
      .min(qMin, `Въпросът трябва да е поне ${qMin} символа.`)
      .max(qMax, `Въпросът може да е най-много ${qMax} символа.`),
    options: z
      .array(
        z.string().trim().min(oMin, 'Попълни всички отговори.').max(oMax, `Отговорите могат да са до ${oMax} символа.`),
      )
      .length(4, 'Трябват точно 4 отговора.'),
    answer: z.number().int().min(0).max(3),
  })
  .refine((d) => new Set(d.options.map((o) => o.toLowerCase())).size === 4, {
    message: 'Отговорите трябва да са различни.',
  });

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

interface Row {
  id: number;
  user_id: number;
  category: CategoryId;
  difficulty: Difficulty;
  q: string;
  options: string;
  answer: number;
  status: SubmissionStatus;
  reason: string | null;
  created_at: number;
  reviewed_at: number | null;
}

function toSubmission(r: Row & UserRow): Submission;
function toSubmission(r: Row, author: UserRow): Submission;
function toSubmission(r: Row, author?: UserRow): Submission {
  const u = author ?? (r as Row & UserRow);
  return {
    id: r.id,
    category: r.category,
    difficulty: r.difficulty,
    q: r.q,
    options: JSON.parse(r.options),
    answer: r.answer,
    status: r.status,
    reason: r.reason,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    author: toPublicUser({ ...u, id: r.user_id }),
  };
}

export function submitQuestion(
  userId: number,
  draft: QuestionDraft,
): { ok: true; submission: Submission } | { ok: false; error: string } {
  const user = getUser(userId)!;
  if (levelFromXp(user.xp) < SUBMISSION_RULES.minLevel) {
    return { ok: false, error: `Можеш да предлагаш въпроси от ниво ${SUBMISSION_RULES.minLevel}.` };
  }
  const pending = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM question_submissions WHERE user_id = ? AND status = 'pending'",
    userId,
  )!.n;
  if (pending >= SUBMISSION_RULES.maxPending) {
    return { ok: false, error: `Имаш ${pending} чакащи въпроса. Изчакай да бъдат прегледани.` };
  }
  const key = normalize(draft.q);
  const duplicate =
    questionBank().some((q) => normalize(q.q) === key) ||
    all<{ q: string }>("SELECT q FROM question_submissions WHERE status = 'pending'").some(
      (r) => normalize(r.q) === key,
    );
  if (duplicate) return { ok: false, error: 'Такъв въпрос вече има.' };

  const { lastInsertRowid } = run(
    `INSERT INTO question_submissions (user_id, category, difficulty, q, options, answer, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    userId,
    draft.category,
    draft.difficulty,
    draft.q,
    JSON.stringify(draft.options),
    draft.answer,
    Date.now(),
  );
  const row = one<Row>('SELECT * FROM question_submissions WHERE id = ?', Number(lastInsertRowid))!;
  return { ok: true, submission: toSubmission(row, user) };
}

export function mySubmissions(userId: number): Submission[] {
  const user = getUser(userId)!;
  return all<Row>(
    'SELECT * FROM question_submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
    userId,
  ).map((r) => toSubmission(r, user));
}

export function listSubmissions(status: SubmissionStatus): Submission[] {
  return all<Row & UserRow>(
    `SELECT u.*, s.* FROM question_submissions s JOIN users u ON u.id = s.user_id
     WHERE s.status = ? ORDER BY s.created_at ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 200`,
    status,
  ).map((r) => toSubmission(r));
}

export function pendingCount(): number {
  return one<{ n: number }>("SELECT COUNT(*) AS n FROM question_submissions WHERE status = 'pending'")!.n;
}

/** Approves (optionally with the moderator's edits) and adds it to the live question bank. */
export function approveSubmission(
  adminId: number,
  id: number,
  edits: QuestionDraft | null,
): { ok: true } | { ok: false; error: string } {
  const row = one<Row>('SELECT * FROM question_submissions WHERE id = ?', id);
  if (!row) return { ok: false, error: 'Няма такова предложение.' };
  if (row.status !== 'pending') return { ok: false, error: 'Предложението вече е прегледано.' };
  const final: QuestionDraft = edits ?? {
    category: row.category,
    difficulty: row.difficulty,
    q: row.q,
    options: JSON.parse(row.options),
    answer: row.answer,
  };
  const questionId = `usr-${id}`;
  tx(() => {
    run(
      `INSERT INTO questions (id, category, difficulty, q, options, answer, author_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      questionId,
      final.category,
      final.difficulty,
      final.q,
      JSON.stringify(final.options),
      final.answer,
      row.user_id,
      Date.now(),
    );
    run(
      `UPDATE question_submissions SET status = 'approved', reviewed_at = ?, reviewed_by = ?, question_id = ?,
         category = ?, difficulty = ?, q = ?, options = ?, answer = ?
       WHERE id = ?`,
      Date.now(),
      adminId,
      questionId,
      final.category,
      final.difficulty,
      final.q,
      JSON.stringify(final.options),
      final.answer,
      id,
    );
    grantXp(row.user_id, SUBMISSION_RULES.approvedXp);
  });
  reloadQuestionBank();
  notify(row.user_id, {
    icon: '✅',
    text: `Въпросът ти „${truncate(final.q)}“ е одобрен и вече е в играта! +${SUBMISSION_RULES.approvedXp} XP`,
    link: '/submit',
  });
  return { ok: true };
}

export function rejectSubmission(
  adminId: number,
  id: number,
  reason: string,
): { ok: true } | { ok: false; error: string } {
  const row = one<Row>('SELECT * FROM question_submissions WHERE id = ?', id);
  if (!row) return { ok: false, error: 'Няма такова предложение.' };
  if (row.status !== 'pending') return { ok: false, error: 'Предложението вече е прегледано.' };
  run(
    "UPDATE question_submissions SET status = 'rejected', reason = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?",
    reason.trim().slice(0, 300) || null,
    Date.now(),
    adminId,
    id,
  );
  notify(row.user_id, { icon: '📝', text: `Въпросът ти „${truncate(row.q)}“ не беше одобрен.`, link: '/submit' });
  return { ok: true };
}

const truncate = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);
