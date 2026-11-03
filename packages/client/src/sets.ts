import type { SetImage, SetQuestion } from '@almanac/shared';
import type { SetBody } from './api';

/**
 * A question of a host's own set as an editor holds it (the web's and the app's): numbers as typed (a comma, a minus on
 * its way), turned into numbers on save; `key` keeps each one itself while they're moved around.
 */
export type SetDraft = { key: number } & (
  | { kind: 'choice'; q: string; options: string[]; answer: number; image?: SetImage }
  | { kind: 'truefalse'; q: string; answer: boolean; image?: SetImage }
  | { kind: 'number'; q: string; answer: string; unit: string; tolerance: string }
  | { kind: 'order'; q: string; items: { text: string; value: string }[]; unit: string }
);

export const blankItems = () => Array.from({ length: 4 }, () => ({ text: '', value: '' }));

let nextKey = 0;
/** A new question: four options, the first marked right until the host says otherwise. */
export const blankDraft = (): SetDraft => ({
  key: nextKey++,
  kind: 'choice',
  q: '',
  options: ['', '', '', ''],
  answer: 0,
});

const typed = (n: number) => String(n).replace('.', ',');

/** A saved question as the editor shows it. */
export function toDraft(q: SetQuestion): SetDraft {
  if (q.kind === 'order')
    return {
      key: nextKey++,
      kind: 'order',
      q: q.q,
      items: q.items.map((i) => ({ text: i.text, value: i.value === null ? '' : typed(i.value) })),
      unit: q.unit,
    };
  if (q.kind !== 'number') return { ...q, key: nextKey++ };
  return {
    key: nextKey++,
    kind: 'number',
    q: q.q,
    answer: typed(q.number.answer),
    unit: q.number.unit,
    tolerance: typed(q.number.tolerance),
  };
}

/**
 * A question switched to another kind, its text kept — and its picture, between the kinds that can have one.
 */
export function switchKind(d: SetDraft, kind: SetDraft['kind']): SetDraft {
  if (kind === d.kind) return d;
  const image = 'image' in d ? d.image : undefined;
  if (kind === 'choice') return { key: d.key, kind: 'choice', q: d.q, options: ['', '', '', ''], answer: 0, image };
  if (kind === 'truefalse') return { key: d.key, kind: 'truefalse', q: d.q, answer: true, image };
  if (kind === 'order') return { key: d.key, kind: 'order', q: d.q, items: blankItems(), unit: '' };
  return { key: d.key, kind: 'number', q: d.q, answer: '', unit: '', tolerance: '' };
}

/** What's saved, keys aside: for telling unsaved changes. */
export const draftContent = (name: string, drafts: SetDraft[]) =>
  JSON.stringify([name, drafts.map(({ key: _, ...d }) => d)]);

/** A number as typed: a comma or a point, spaces between thousands; null when it isn't one. */
export const parseNumber = (s: string) => {
  const n = Number(s.trim().replace(/\s/g, '').replace(',', '.'));
  return s.trim() && Number.isFinite(n) ? n : null;
};

/** The set as the server takes it, or what's wrong with a number in it. */
export function toSetBody(name: string, drafts: SetDraft[]): { body: SetBody } | { error: string } {
  const questions: SetQuestion[] = [];
  for (const [i, { key: _, ...d }] of drafts.entries()) {
    if (d.kind === 'order') {
      const values = d.items.map((item) => (item.value.trim() ? parseNumber(item.value) : null));
      if (d.items.some((item, j) => item.value.trim() && values[j] === null))
        return { error: `Въпрос ${i + 1}: числата за подреждане трябва да са числа.` };
      questions.push({
        kind: 'order',
        q: d.q,
        items: d.items.map((item, j) => ({ text: item.text, value: values[j] ?? null })),
        unit: d.unit,
      });
      continue;
    }
    if (d.kind !== 'number') {
      questions.push(d);
      continue;
    }
    const answer = parseNumber(d.answer);
    const tolerance = parseNumber(d.tolerance);
    if (answer === null) return { error: `Въпрос ${i + 1}: напиши верния отговор като число.` };
    if (tolerance === null || tolerance <= 0) return { error: `Въпрос ${i + 1}: отклонението е число над нула.` };
    questions.push({ kind: 'number', q: d.q, number: { answer, unit: d.unit, tolerance } });
  }
  return { body: { name, questions } };
}

/** A sensible "how far off scores nothing": ten years for a year, a tenth of anything else. */
export function defaultTolerance(answer: string): string {
  const n = parseNumber(answer);
  if (n === null) return '';
  if (Number.isInteger(n) && n >= 1000 && n <= 2100) return '10';
  return typed(Math.max(1, Math.round(Math.abs(n) / 10)));
}

/** A shared set's kinds in words, for its preview: „12 с избор, 3 вярно/невярно, 2 с число, 1 за подреждане“. */
export function setKinds(k: { choice: number; truefalse: number; number: number; order: number }): string {
  return [
    k.choice && `${k.choice} с избор`,
    k.truefalse && `${k.truefalse} вярно/невярно`,
    k.number && `${k.number} с число`,
    // From a server before „Подреди“ in sets: none.
    k.order && `${k.order} за подреждане`,
  ]
    .filter(Boolean)
    .join(', ');
}
