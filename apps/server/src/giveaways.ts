/**
 * What "a question gives another away" is made of, in one place for everything that judges it: the server, which keeps
 * such pairs out of one match (findConflicts in questions.ts); the bank test, which fails on the plain ones
 * (test/questions.test.ts); and the bank tool, which lists the rest for the writer to judge (.claude/skills/
 * question-bank/bank.mjs, which imports this file as it is: no imports of its own, nothing Node can't strip). Each
 * applies its own rule; the words, stems and limits are the same (the 31 October review, REPO-9).
 */

/** Lower case, letters and digits only, one space between words: „Марс,“ and „марс“ are the same word. */
export const plainWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Stems every other question has („колко“, „годин…“): two questions sharing them aren't on the same subject. */
export const COMMON_STEMS = new Set([
  'колко',
  'която',
  'което',
  'които',
  'какво',
  'какъв',
  'каква',
  'какви',
  'годин',
  'чийто',
  'чиято',
  'бълга',
]);

/**
 * Rough word stems: the first five letters of each word of five or more, without COMMON_STEMS — enough to spot the
 * same subject reworded. `numbers`: numbers of three digits or more count as words too (a year, a height).
 */
export function stems(text: string, { numbers = false } = {}): Set<string> {
  return new Set(
    plainWords(text)
      .split(' ')
      .filter((w) => (/^\d+$/.test(w) ? numbers && w.length >= 3 : w.length >= 5))
      .map((w) => w.slice(0, 5))
      .filter((w) => !COMMON_STEMS.has(w)),
  );
}

/** An answer more questions than this name is common knowledge (a country, a big city), not a giveaway. */
export const COMMON_ANSWER = 20;

/** Endings a one-word Bulgarian answer takes in another question's text: „Марс“ in „Марсът“, „планина“ in „планините“. */
export const BG_ENDINGS = ['а', 'я', 'ът', 'ят', 'та', 'то', 'те', 'и', 'ите', 'ове', 'овете'];

/**
 * What a question shows besides its own text, where it can name another's answer too: its „Знаеше ли?“ fact (on screen
 * before the next question), its order items, a picture's description (a draft's `alt`, before the picture is made).
 */
export function aroundText(q: {
  fact?: string | null;
  items?: readonly { text: string }[];
  image?: { alt: string } | null;
  alt?: string;
}): string {
  return [q.fact ?? '', ...(q.items ?? []).map((i) => i.text), q.image?.alt ?? q.alt ?? ''].join(' ');
}
