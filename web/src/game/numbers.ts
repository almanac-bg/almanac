// How the game says its numbers: a share of players („58%“), the close answers beside a score's right ones, how a
// game's own players did with a question, and a count with its noun.

import type { Crowd, Mark } from "./types.ts";

/** A share as the game writes it: „58%“, and „под 1%“ for what rounds to nothing but isn't. */
export function percent(x: number): string {
  return x > 0 && x < 0.005 ? "под 1%" : `${Math.round(x * 100)}%`;
}

/** The close answers beside a score's right ones („ · 1 близо“), "" for none: they bring points too, so that none right
 * with its points never reads as a mistake. */
export function closeWords(trail: Mark[] = []): string {
  const n = trail.filter((m) => m?.partial && !m.right && !m.void).length;
  return n ? ` · ${n} близо` : "";
}

/** The share of players right at or under which a right answer is a rare one, told in gold: a quarter. */
export const rare = 0.25;

/** A crowd as the player sees it with their answer: the others' (as the server counts them: the day's are the others',
 * and everyone's ever has this answer only once it's counted again), with the player's own answer counted in — `mine`,
 * the place of the option they picked (-1: none, or a kind without options), and whether it was right — so that what
 * they picked never reads „0%“, and the shares and the line under them add up. A counted crowd (a room's, Роял's: the
 * game's own) has everyone's already. */
export function withOwn(c: Crowd, mine: number, right: boolean): Crowd {
  if (c.counts) return c;
  const n = c.answers;
  const picks = c.picks?.map((x, i) => (x * n + (i === mine ? 1 : 0)) / (n + 1));
  return { ...c, answers: n + 1, right: (c.right * n + (right ? 1 : 0)) / (n + 1), picks };
}

/** How a game's own players did with a question, counted (Роял's: everyone in it had the question then): „Познаха 3
 * от 12.“, „Само ти позна.“, „Всички познаха.“, „Никой не позна.“ Nothing for one: the verdict says it. */
export function countedWords(c: Crowd, right: boolean): string {
  const n = c.answers;
  const k = Math.round(c.right * n);
  if (n < 2) return "";
  if (k === 0) return "Никой не позна.";
  if (k === n) return "Всички познаха.";
  return k === 1 && right ? "Само ти позна." : `Познаха ${k} от ${n}.`;
}

/** A count with its noun, one or many, in Bulgarian digits: „1 ден“, „12 дни“, „1 234 отговора“. */
export const count = (n: number, one: string, many: string) =>
  `${new Intl.NumberFormat("bg", { useGrouping: n >= 10000 }).format(n)} ${n === 1 ? one : many}`;
