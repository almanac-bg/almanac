import { randomBytes } from 'node:crypto';
import {
  type QuestionSetInfo,
  type QuestionSetSummary,
  type RoomSettings,
  SETS,
  type SetQuestion,
  type SharedSetPreview,
} from '@quiz/shared';
import { z } from 'zod';
import { all, one, run } from './db';
import { type PreparedQuestion, shuffle } from './questions';

/**
 * „Моите въпроси“: a host's own question sets (SETS), for their private rooms — a teacher's quiz on the lesson, an
 * office's on the year. Never in the bank: they're played only where their owner hosts (or whoever took a copy from
 * the share link), and a match on one says nothing about anyone's knowledge (see the rewards).
 */

interface SetRow {
  id: number;
  owner_id: number;
  name: string;
  code: string;
  questions: string;
  hidden: number;
  copied_from: number | null;
  created_at: number;
  updated_at: number;
}

/** Text as typed, tidied: one space between words. */
const text = (min: number, max: number, what: string) =>
  z
    .string()
    .transform((s) => s.normalize('NFC').replace(/\s+/gu, ' ').trim())
    .pipe(z.string().min(min, `${what}: поне ${min} знака.`).max(max, `${what}: най-много ${max} знака.`));

const QuestionText = text(SETS.question[0], SETS.question[1], 'Въпросът');

const SetQuestionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('choice'),
      q: QuestionText,
      options: z.array(text(SETS.option[0], SETS.option[1], 'Отговорът')).length(4, 'Въпросът иска четири отговора.'),
      answer: z.number().int().min(0).max(3),
    })
    .refine((q) => new Set(q.options.map((o) => o.toLocaleLowerCase('bg'))).size === 4, {
      message: 'Двата отговора на един въпрос са еднакви.',
    }),
  z.object({ kind: z.literal('truefalse'), q: QuestionText, answer: z.boolean() }),
  z.object({
    kind: z.literal('number'),
    q: QuestionText,
    number: z.object({
      answer: z.number().finite().min(-1e12).max(1e12),
      unit: z
        .string()
        .transform((s) => s.trim())
        .pipe(z.string().max(SETS.unit, `Мерната единица е до ${SETS.unit} знака.`)),
      tolerance: z.number().finite().positive('Отклонението трябва да е над нула.').max(1e12),
    }),
  }),
]);

export const SetSchema = z.object({
  name: text(SETS.name[0], SETS.name[1], 'Името'),
  questions: z.array(SetQuestionSchema).max(SETS.maxQuestions, `Най-много ${SETS.maxQuestions} въпроса.`),
});

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const newCode = () => randomBytes(6).toString('base64url');
const questionsOf = (row: SetRow) => JSON.parse(row.questions) as SetQuestion[];
const getRow = (id: number) => one<SetRow>('SELECT * FROM question_sets WHERE id = ?', id);
const owned = (id: number, userId: number) => {
  const row = getRow(id);
  return row && row.owner_id === userId ? row : undefined;
};

function info(row: SetRow): QuestionSetInfo {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    questions: questionsOf(row),
    hidden: row.hidden === 1,
    updatedAt: row.updated_at,
  };
}

/** The first problem with a set as sent, in words; or the set, tidied. */
function parseSet(body: unknown): Result<{ set: z.infer<typeof SetSchema> }> {
  const parsed = SetSchema.safeParse(body, { error: () => 'Невалиден набор.' });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where =
      issue?.path[0] === 'questions' && typeof issue.path[1] === 'number' ? `Въпрос ${issue.path[1] + 1}: ` : '';
    return { ok: false, error: `${where}${issue?.message ?? 'Невалиден набор.'}` };
  }
  return { ok: true, set: parsed.data };
}

export function mySets(userId: number): QuestionSetSummary[] {
  return all<SetRow>('SELECT * FROM question_sets WHERE owner_id = ? ORDER BY updated_at DESC', userId).map((r) => ({
    id: r.id,
    name: r.name,
    questions: questionsOf(r).length,
    hidden: r.hidden === 1,
    updatedAt: r.updated_at,
  }));
}

export function getSet(id: number, userId: number): QuestionSetInfo | null {
  const row = owned(id, userId);
  return row ? info(row) : null;
}

export function createSet(userId: number, body: unknown, copiedFrom: number | null = null): Result<{ id: number }> {
  const parsed = parseSet(body);
  if (!parsed.ok) return parsed;
  const count = one<{ n: number }>('SELECT COUNT(*) AS n FROM question_sets WHERE owner_id = ?', userId)!.n;
  if (count >= SETS.perOwner) return { ok: false, error: `Можеш да имаш най-много ${SETS.perOwner} набора.` };
  const now = Date.now();
  const id = Number(
    run(
      `INSERT INTO question_sets (owner_id, name, code, questions, copied_from, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      userId,
      parsed.set.name,
      newCode(),
      JSON.stringify(parsed.set.questions),
      copiedFrom,
      now,
      now,
    ).lastInsertRowid,
  );
  return { ok: true, id };
}

export function saveSet(id: number, userId: number, body: unknown): Result<{ set: QuestionSetInfo }> {
  if (!owned(id, userId)) return { ok: false, error: 'Няма такъв набор.' };
  const parsed = parseSet(body);
  if (!parsed.ok) return parsed;
  run(
    'UPDATE question_sets SET name = ?, questions = ?, updated_at = ? WHERE id = ?',
    parsed.set.name,
    JSON.stringify(parsed.set.questions),
    Date.now(),
    id,
  );
  return { ok: true, set: info(getRow(id)!) };
}

export function deleteSet(id: number, userId: number): boolean {
  return Number(run('DELETE FROM question_sets WHERE id = ? AND owner_id = ?', id, userId).changes) > 0;
}

/** A set's share link as anyone signed in sees it (a hidden one is gone, but for moderators). */
export function sharedPreview(code: string, viewerId: number, admin = false): SharedSetPreview | null {
  const row = one<SetRow & { username: string | null }>(
    'SELECT s.*, u.username FROM question_sets s LEFT JOIN users u ON u.id = s.owner_id WHERE s.code = ?',
    code,
  );
  if (!row || (row.hidden && !admin && row.owner_id !== viewerId)) return null;
  const questions = questionsOf(row);
  return {
    name: row.name,
    author: row.username,
    questions: questions.length,
    kinds: {
      choice: questions.filter((q) => q.kind === 'choice').length,
      truefalse: questions.filter((q) => q.kind === 'truefalse').length,
      number: questions.filter((q) => q.kind === 'number').length,
    },
    mine: row.owner_id === viewerId ? row.id : null,
    hidden: row.hidden === 1,
  };
}

/** Takes a copy of a shared set into the viewer's own (theirs to edit from then on). */
export function copySet(code: string, userId: number): Result<{ id: number }> {
  const row = one<SetRow>('SELECT * FROM question_sets WHERE code = ? AND hidden = 0', code);
  if (!row) return { ok: false, error: 'Този набор вече не е достъпен.' };
  if (row.owner_id === userId) return { ok: true, id: row.id };
  return createSet(userId, { name: row.name, questions: questionsOf(row) }, row.id);
}

/** A moderator hides a set a report held up about (or shows it again): it can't be played or copied meanwhile. */
export function hideSet(code: string, hidden: boolean): boolean {
  return Number(run('UPDATE question_sets SET hidden = ? WHERE code = ?', hidden ? 1 : 0, code).changes) > 0;
}

/** A set its owner can play in a room: theirs, not hidden, with questions in it. */
export function setForRoom(id: number, userId: number): RoomSettings['set'] | 'empty' | null {
  const row = owned(id, userId);
  if (!row || row.hidden) return null;
  const count = questionsOf(row).length;
  return count ? { id: row.id, name: row.name, questions: count } : 'empty';
}

/** How a set's number question is entered and scored: the range around the answer, in steps of its precision. */
function numberSpec(n: { answer: number; unit: string; tolerance: number }) {
  const decimals = Math.min(2, (String(n.answer).split('.')[1] ?? '').length);
  const step = 10 ** -decimals;
  const span = Math.max(n.tolerance * 5, step * 10);
  const low = n.answer - span;
  return {
    answer: n.answer,
    unit: n.unit,
    min: n.answer >= 0 ? Math.max(0, low) : low,
    max: n.answer + span,
    step,
    scale: 'linear' as const,
    tolerance: n.tolerance,
  };
}

/**
 * A set's questions as a room plays them, in its owner's order (options shuffled; true or false in that order).
 * The latest version: what the host saved last. Null when it can't be played.
 */
export function prepareSet(id: number, userId: number): PreparedQuestion[] | null {
  const row = owned(id, userId);
  if (!row || row.hidden) return null;
  const common = (i: number) => ({
    id: `set-${row.id}-${i}`,
    category: 'general' as const,
    difficulty: 'medium' as const,
  });
  return questionsOf(row).map((q, i): PreparedQuestion => {
    if (q.kind === 'number') return { ...common(i), kind: 'number', q: q.q, number: numberSpec(q.number) };
    if (q.kind === 'truefalse')
      return { ...common(i), q: q.q, options: ['Вярно', 'Невярно'], answer: q.answer ? 0 : 1 };
    const order = shuffle([0, 1, 2, 3]);
    return { ...common(i), q: q.q, options: order.map((o) => q.options[o]), answer: order.indexOf(q.answer) };
  });
}
