import { type QuestionDraft, SUBMISSION_RULES, type SubmissionStatus } from '@quiz/shared';

export const SUBMISSION_STATUS: Record<SubmissionStatus, { label: string; className: string }> = {
  pending: { label: 'Чака одобрение', className: 'bg-amber-400/15 text-amber-300' },
  approved: { label: 'Одобрен', className: 'bg-emerald-400/15 text-emerald-300' },
  rejected: { label: 'Отхвърлен', className: 'bg-rose-500/15 text-rose-300' },
};

export const OPTION_COLORS = ['#a78bfa', '#22d3ee', '#fbbf24', '#f472b6'];
export const LETTERS = ['А', 'Б', 'В', 'Г'];

/** `answer: -1` means "not marked yet". */
export const emptyDraft = (): QuestionDraft => ({
  category: 'general',
  difficulty: 'easy',
  q: '',
  options: ['', '', '', ''],
  answer: -1,
});

export interface DraftErrors {
  q?: string;
  options?: string;
  answer?: string;
}

/** Mirrors the server's rules so mistakes show up before submitting. */
export function validateDraft(d: QuestionDraft): DraftErrors {
  const errors: DraftErrors = {};
  const [qMin, qMax] = SUBMISSION_RULES.question;
  const [oMin, oMax] = SUBMISSION_RULES.option;
  const q = d.q.trim();
  if (q.length < qMin) errors.q = `Въпросът трябва да е поне ${qMin} символа.`;
  else if (q.length > qMax) errors.q = `Въпросът може да е най-много ${qMax} символа.`;

  const options = d.options.map((o) => o.trim());
  if (options.some((o) => o.length < oMin)) errors.options = 'Попълни всички отговори.';
  else if (options.some((o) => o.length > oMax)) errors.options = `Отговорите могат да са до ${oMax} символа.`;
  else if (new Set(options.map((o) => o.toLowerCase())).size !== 4)
    errors.options = 'Отговорите трябва да са различни.';

  if (d.answer < 0 || d.answer > 3) errors.answer = 'Отбележи верния отговор.';
  return errors;
}

export const hasErrors = (e: DraftErrors) => Object.keys(e).length > 0;

export const cleanDraft = (d: QuestionDraft): QuestionDraft => ({
  ...d,
  q: d.q.trim(),
  options: d.options.map((o) => o.trim()),
});

export const draftsEqual = (a: QuestionDraft, b: QuestionDraft) =>
  JSON.stringify(cleanDraft(a)) === JSON.stringify(cleanDraft(b));
