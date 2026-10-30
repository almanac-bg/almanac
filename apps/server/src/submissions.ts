import {
  CATEGORY_IDS,
  type CategoryId,
  type Difficulty,
  levelFromXp,
  MODERATION,
  type QuestionDraft,
  type SimilarQuestion,
  SUBMISSION_RULES,
  type Submission,
  type SubmissionStatus,
} from '@quiz/shared';
import { z } from 'zod';
import { grantXp } from './account';
import { all, one, run, tx } from './db';
import { logAction } from './modlog';
import { notify } from './notifications';
import { questionBank, reloadQuestionBank } from './questions';
import { sentence } from './statements';
import { getUser, toPublicUser, type UserRow } from './users';

const [qMin, qMax] = SUBMISSION_RULES.question;
const [oMin, oMax] = SUBMISSION_RULES.option;
const [fMin, fMax] = SUBMISSION_RULES.fact;

const Https = z.url({ protocol: /^https$/, message: 'Източникът трябва да е линк (https://…).' });

export const DraftSchema = z
  .object({
    category: z.enum(CATEGORY_IDS as [CategoryId, ...CategoryId[]], { message: 'Избери категория.' }),
    difficulty: z.enum(['easy', 'medium', 'hard'], { message: 'Избери трудност.' }),
    q: z
      .string()
      .trim()
      .min(qMin, `Въпросът трябва да е поне ${qMin} знака.`)
      .max(qMax, `Въпросът може да е най-много ${qMax} знака.`),
    options: z
      .array(
        z.string().trim().min(oMin, 'Попълни всички отговори.').max(oMax, `Отговорите могат да са до ${oMax} знака.`),
      )
      .length(4, 'Трябват точно 4 отговора.'),
    answer: z.number().int().min(0).max(3),
    answerSource: Https,
    fact: z
      .string()
      .trim()
      .max(fMax, `„Знаеше ли?“ е до ${fMax} знака.`)
      .optional()
      .transform((f) => f || undefined),
    factSource: z
      .string()
      .trim()
      .optional()
      .transform((f) => f || undefined),
  })
  .refine((d) => new Set(d.options.map((o) => o.toLowerCase())).size === 4, {
    message: 'Отговорите трябва да са различни.',
  })
  .refine((d) => !d.fact || d.fact.length >= fMin, { message: `„Знаеше ли?“ е поне ${fMin} знака.` })
  .refine((d) => !d.fact || (d.factSource && Https.safeParse(d.factSource).success), {
    message: 'Фактът иска линк към източник (https://…).',
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
  question_id: string | null;
  answer_source: string | null;
  fact: string | null;
  fact_source: string | null;
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
    ...(r.answer_source && { answerSource: r.answer_source }),
    ...(r.fact && { fact: r.fact, factSource: r.fact_source ?? undefined }),
    status: r.status,
    reason: r.reason,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    author: toPublicUser({ ...u, id: r.user_id }),
    questionId: r.question_id,
    played: r.question_id ? playedSoFar(r.question_id) : null,
  };
}

function playedSoFar(questionId: string): Submission['played'] {
  const stats = one<{ answered: number; correct: number }>(
    'SELECT answered, correct FROM question_stats WHERE question_id = ?',
    questionId,
  );
  return stats ?? { answered: 0, correct: 0 };
}

/**
 * How many may wait at once: a few until one has been approved (a newcomer's first tries), more once one has; one at
 * a time after many were turned down.
 */
function pendingLimit(userId: number): number {
  const done = one<{ approved: number; rejected: number }>(
    `SELECT SUM(status = 'approved') AS approved, SUM(status = 'rejected') AS rejected FROM question_submissions
     WHERE user_id = ?`,
    userId,
  )!;
  if ((done.rejected ?? 0) >= SUBMISSION_RULES.rejectedLimit && (done.rejected ?? 0) > (done.approved ?? 0))
    return SUBMISSION_RULES.maxPendingRejected;
  return done.approved ? SUBMISSION_RULES.maxPending : SUBMISSION_RULES.maxPendingNew;
}

/** The same question already in the game, or waiting (other than `except`, the one being edited). */
function isDuplicate(text: string, except: number | null = null): boolean {
  const key = normalize(text);
  return (
    questionBank().some((q) => normalize(q.q) === key) ||
    all<{ id: number; q: string }>("SELECT id, q FROM question_submissions WHERE status = 'pending'").some(
      (r) => r.id !== except && normalize(r.q) === key,
    )
  );
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
  const limit = pendingLimit(userId);
  if (pending >= limit) {
    return {
      ok: false,
      error:
        limit === 1
          ? 'Имаш чакащ въпрос. Изчакай да бъде прегледан.'
          : `Имаш ${pending} чакащи въпроса. Изчакай да бъдат прегледани.`,
    };
  }
  if (isDuplicate(draft.q)) return { ok: false, error: 'Такъв въпрос вече има.' };

  const { lastInsertRowid } = run(
    `INSERT INTO question_submissions
       (user_id, category, difficulty, q, options, answer, answer_source, fact, fact_source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    draft.category,
    draft.difficulty,
    draft.q,
    JSON.stringify(draft.options),
    draft.answer,
    draft.answerSource ?? null,
    draft.fact ?? null,
    draft.fact ? (draft.factSource ?? null) : null,
    Date.now(),
  );
  const row = one<Row>('SELECT * FROM question_submissions WHERE id = ?', Number(lastInsertRowid))!;
  return { ok: true, submission: toSubmission(row, user) };
}

/** The author changes a question still waiting (an approved or rejected one is done). */
export function editSubmission(
  userId: number,
  id: number,
  draft: QuestionDraft,
): { ok: true; submission: Submission } | { ok: false; error: string } {
  const row = one<Row>('SELECT * FROM question_submissions WHERE id = ? AND user_id = ?', id, userId);
  if (!row) return { ok: false, error: 'Няма такова предложение.' };
  if (row.status !== 'pending') return { ok: false, error: 'Вече е прегледано.' };
  if (isDuplicate(draft.q, id)) return { ok: false, error: 'Такъв въпрос вече има.' };
  run(
    `UPDATE question_submissions SET category = ?, difficulty = ?, q = ?, options = ?, answer = ?, answer_source = ?,
       fact = ?, fact_source = ? WHERE id = ?`,
    draft.category,
    draft.difficulty,
    draft.q,
    JSON.stringify(draft.options),
    draft.answer,
    draft.answerSource ?? null,
    draft.fact ?? null,
    draft.fact ? (draft.factSource ?? null) : null,
    id,
  );
  return {
    ok: true,
    submission: toSubmission(one<Row>('SELECT * FROM question_submissions WHERE id = ?', id)!, getUser(userId)!),
  };
}

/** The author takes back a question still waiting. */
export function withdrawSubmission(userId: number, id: number): boolean {
  return (
    Number(
      run("DELETE FROM question_submissions WHERE id = ? AND user_id = ? AND status = 'pending'", id, userId).changes,
    ) > 0
  );
}

/** Rough word stems (as the bank tool compares questions): enough to spot the same question reworded. */
const stems = (text: string) =>
  new Set(
    normalize(text)
      .split(' ')
      .filter((w) => w.length >= 5)
      .map((w) => w.slice(0, 5)),
  );

/**
 * Questions in the game a proposed one looks like (a duplicate, or one it answers): sharing the answer and a key word,
 * or most of their words. For the moderator to judge.
 */
export function similarQuestions(id: number): SimilarQuestion[] {
  const row = one<Row>('SELECT * FROM question_submissions WHERE id = ?', id);
  if (!row) return [];
  const options = JSON.parse(row.options) as string[];
  const answer = normalize(options[row.answer]);
  const words = stems(`${row.q} ${options[row.answer]}`);
  // The bank, and the other proposals still waiting: two players can send the same question in the same week.
  const candidates: SimilarQuestion[] = [
    ...questionBank()
      .filter((q) => q.id !== row.question_id)
      .map((q) => ({ id: q.id, q: q.q, answer: q.options[q.answer] })),
    ...all<Row>(
      "SELECT * FROM question_submissions WHERE status = 'pending' AND id <> ? ORDER BY id LIMIT 500",
      id,
    ).map((r) => ({ id: `предложение №${r.id}`, q: r.q, answer: (JSON.parse(r.options) as string[])[r.answer] })),
  ];
  const scored: { q: SimilarQuestion; score: number }[] = [];
  for (const q of candidates) {
    const other = stems(`${q.q} ${q.answer}`);
    const shared = [...words].filter((w) => other.has(w)).length;
    const sameAnswer = normalize(q.answer) === answer;
    const overlap = shared / Math.max(1, Math.min(words.size, other.size));
    if ((sameAnswer && shared >= 1) || (shared >= 2 && overlap >= 0.5))
      scored.push({ q, score: overlap + (sameAnswer ? 1 : 0) });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ q }) => q);
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
    answerSource: row.answer_source ?? undefined,
    fact: row.fact ?? undefined,
    factSource: row.fact_source ?? undefined,
  };
  const questionId = `usr-${id}`;
  tx(() => {
    run(
      `INSERT INTO questions (id, category, difficulty, q, options, answer, author_id, answer_source, fact, fact_source,
         created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      questionId,
      final.category,
      final.difficulty,
      final.q,
      JSON.stringify(final.options),
      final.answer,
      row.user_id,
      final.answerSource ?? null,
      final.fact ?? null,
      final.fact ? (final.factSource ?? null) : null,
      Date.now(),
    );
    // Undone, it leaves play (hidden): a question already played keeps its id and its numbers.
    logAction({ adminId, action: 'approve', userId: row.user_id, target: questionId, undo: {} });
    // All of it as approved (with the moderator's edits): „Одобрени“ and the author's own list show what's in play, and
    // „Поправи“ from there starts from it — a source or a fact left behind would wipe the live one.
    run(
      `UPDATE question_submissions SET status = 'approved', reviewed_at = ?, reviewed_by = ?, question_id = ?,
         category = ?, difficulty = ?, q = ?, options = ?, answer = ?, answer_source = ?, fact = ?, fact_source = ?
       WHERE id = ?`,
      Date.now(),
      adminId,
      questionId,
      final.category,
      final.difficulty,
      final.q,
      JSON.stringify(final.options),
      final.answer,
      final.answerSource ?? null,
      final.fact ?? null,
      final.fact ? (final.factSource ?? null) : null,
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
  // The author learns why: a „не“ alone teaches nothing about the next one.
  const why = reason.trim().slice(0, 300);
  if (why.length < MODERATION.reasonMin)
    return { ok: false, error: `Напиши защо (поне ${MODERATION.reasonMin} знака): авторът ще го прочете.` };
  tx(() => {
    run(
      "UPDATE question_submissions SET status = 'rejected', reason = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?",
      why,
      Date.now(),
      adminId,
      id,
    );
    // The question itself, since a rejected one has no id in the game to look it up by.
    logAction({ adminId, action: 'reject', userId: row.user_id, reason: `„${row.q}“ ${why}` });
  });
  notify(row.user_id, {
    icon: '📝',
    text: `Въпросът ти „${truncate(row.q)}“ не беше одобрен. Причина: ${sentence(why)}`,
    link: '/submit',
  });
  return { ok: true };
}

/** A moderator corrects a player's question already in the game (its id and stats stay). */
export function editCommunityQuestion(
  adminId: number,
  questionId: string,
  draft: QuestionDraft,
): { ok: true } | { ok: false; error: string } {
  const before = one<{ q: string }>('SELECT q FROM questions WHERE id = ?', questionId);
  if (!before) return { ok: false, error: 'Няма такъв въпрос на играч.' };
  tx(() => {
    run(
      `UPDATE questions SET category = ?, difficulty = ?, q = ?, options = ?, answer = ?, answer_source = ?, fact = ?,
         fact_source = ? WHERE id = ?`,
      draft.category,
      draft.difficulty,
      draft.q,
      JSON.stringify(draft.options),
      draft.answer,
      draft.answerSource ?? null,
      draft.fact ?? null,
      draft.fact ? (draft.factSource ?? null) : null,
      questionId,
    );
    // The author's list shows it as it's played now.
    run(
      `UPDATE question_submissions SET category = ?, difficulty = ?, q = ?, options = ?, answer = ?, answer_source = ?,
         fact = ?, fact_source = ? WHERE question_id = ?`,
      draft.category,
      draft.difficulty,
      draft.q,
      JSON.stringify(draft.options),
      draft.answer,
      draft.answerSource ?? null,
      draft.fact ?? null,
      draft.fact ? (draft.factSource ?? null) : null,
      questionId,
    );
    logAction({ adminId, action: 'edit_question', target: questionId, reason: `Беше: „${before.q}“` });
  });
  reloadQuestionBank();
  return { ok: true };
}

const truncate = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);
