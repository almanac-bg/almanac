import { type QuestionDraft, SUBMISSION_RULES, type SubmissionStatus } from '@almanac/shared';

/** A submission's status, in a word. */
export const SUBMISSION_LABELS: Record<SubmissionStatus, string> = {
  pending: 'Чака одобрение',
  approved: 'Одобрен',
  rejected: 'Отхвърлен',
};

/** A new question to propose; `answer: -1` means "not marked yet". */
export const emptyQuestionDraft = (): QuestionDraft => ({
  category: 'general',
  difficulty: 'easy',
  q: '',
  options: ['', '', '', ''],
  answer: -1,
  answerSource: '',
  fact: '',
  factSource: '',
});

export interface DraftErrors {
  q?: string;
  options?: string;
  answer?: string;
  answerSource?: string;
  fact?: string;
  factSource?: string;
}

/**
 * A link a source can be: https, no spaces, a host of names joined by dots. Read in two steps rather than by `new URL()`,
 * which React Native doesn't fully have, or by one pattern, which backtracks on a long host of dots (CodeQL's polynomial
 * ReDoS); each step's pattern can match only one way. The server checks it again.
 */
export function isHttpsLink(text: string) {
  if (!/^https:\/\/\S+$/i.test(text)) return false;
  const host = text.slice('https://'.length).split(/[/?#]/, 1)[0] ?? '';
  return /^[^.]+(?:\.[^.]+)+$/.test(host);
}

/** Mirrors the server's rules so mistakes show up before submitting. */
export function validateDraft(d: QuestionDraft): DraftErrors {
  const errors: DraftErrors = {};
  const [qMin, qMax] = SUBMISSION_RULES.question;
  const [oMin, oMax] = SUBMISSION_RULES.option;
  const q = d.q.trim();
  if (q.length < qMin) errors.q = `Въпросът трябва да е поне ${qMin} знака.`;
  else if (q.length > qMax) errors.q = `Въпросът може да е най-много ${qMax} знака.`;

  const options = d.options.map((o) => o.trim());
  if (options.some((o) => o.length < oMin)) errors.options = 'Попълни всички отговори.';
  else if (options.some((o) => o.length > oMax)) errors.options = `Отговорите могат да са до ${oMax} знака.`;
  else if (new Set(options.map((o) => o.toLowerCase())).size !== 4)
    errors.options = 'Отговорите трябва да са различни.';

  if (d.answer < 0 || d.answer > 3) errors.answer = 'Отбележи верния отговор.';

  const source = d.answerSource?.trim() ?? '';
  if (!source) errors.answerSource = 'Посочи къде се проверява верният отговор.';
  else if (!isHttpsLink(source)) errors.answerSource = 'Източникът трябва да е линк (https://…).';

  const [fMin, fMax] = SUBMISSION_RULES.fact;
  const fact = d.fact?.trim() ?? '';
  const factSource = d.factSource?.trim() ?? '';
  if (fact) {
    if (fact.length < fMin) errors.fact = `„Знаеше ли?“ е поне ${fMin} знака.`;
    else if (fact.length > fMax) errors.fact = `„Знаеше ли?“ е до ${fMax} знака.`;
    if (!isHttpsLink(factSource)) errors.factSource = 'Фактът иска линк към източник (https://…).';
  }
  return errors;
}

export const hasErrors = (e: DraftErrors) => Object.keys(e).length > 0;

/** Trimmed, as the server takes it: no fact means no fact source either. */
export const cleanDraft = (d: QuestionDraft): QuestionDraft => {
  const fact = d.fact?.trim();
  return {
    category: d.category,
    difficulty: d.difficulty,
    q: d.q.trim(),
    options: d.options.map((o) => o.trim()),
    answer: d.answer,
    answerSource: d.answerSource?.trim() ?? '',
    ...(fact && { fact, factSource: d.factSource?.trim() ?? '' }),
  };
};

/** A question as its editor holds it: every field a string, so the inputs stay controlled. */
export const toQuestionDraft = (d: QuestionDraft): QuestionDraft => ({
  category: d.category,
  difficulty: d.difficulty,
  q: d.q,
  options: [...d.options],
  answer: d.answer,
  answerSource: d.answerSource ?? '',
  fact: d.fact ?? '',
  factSource: d.factSource ?? '',
});

export const draftsEqual = (a: QuestionDraft, b: QuestionDraft) =>
  JSON.stringify(cleanDraft(a)) === JSON.stringify(cleanDraft(b));

/** How many may wait at once (as the server counts it): a few until one is approved, one at a time after many turned down. */
export function pendingLimit(items: { status: SubmissionStatus }[]) {
  const approved = items.filter((s) => s.status === 'approved').length;
  const rejected = items.filter((s) => s.status === 'rejected').length;
  if (rejected >= SUBMISSION_RULES.rejectedLimit && rejected > approved) return SUBMISSION_RULES.maxPendingRejected;
  return approved ? SUBMISSION_RULES.maxPending : SUBMISSION_RULES.maxPendingNew;
}
