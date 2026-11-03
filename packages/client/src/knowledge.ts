import type { KnowledgeFact } from '@almanac/shared';
import { numberText } from './numbers';
import { keepTogether } from './typography';

/** A fact's answer as „Моите знания“ shows it: the number with its unit, the order's things in turn, or the option. */
export function factAnswer(fact: KnowledgeFact): string {
  if (fact.number) return numberText(fact.number.answer, fact.number);
  if (fact.order) return fact.order.items.map((i) => keepTogether(i.text)).join(' → ');
  return keepTogether(fact.answer ?? '');
}

/** A search's words, lowercased as Bulgarian is. */
export const searchWords = (query: string) => query.toLocaleLowerCase('bg').split(/\s+/u).filter(Boolean);

/** Whether a fact has every word of a search, in its question, its answer (whatever its kind) or the fact. */
export function factMatches(fact: KnowledgeFact, words: string[]): boolean {
  // Spaces as typed: the ones that keep a number with its word are spaces too, and a word joiner is nothing.
  const text = `${fact.q} ${factAnswer(fact)} ${fact.fact}`
    .replace(/\u2060/g, '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .toLocaleLowerCase('bg');
  return words.every((w) => text.includes(w));
}
