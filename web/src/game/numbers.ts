// How the game says its numbers: a share of players („58 %“), the close answers beside a score's right ones, how a
// game's own players did with a question, and a count with its noun.

import type { Crowd, Mark } from "./types.ts";

/** A share as the game writes it: „58 %“, and „под 1 %“ for what rounds to nothing but isn't. */
export function percent(x: number): string {
  return x > 0 && x < 0.005 ? "под 1\u00a0%" : `${Math.round(x * 100)}\u00a0%`;
}

/** The close answers beside a score's right ones („ · 1 близо“, glued to the score: the dot never starts a line), ""
 * for none: they count as not right, but a game of near misses never reads as nothing. */
export function closeWords(trail: Mark[] = []): string {
  const n = closeCount(trail);
  return n ? `\u00a0· ${n}\u00a0близо` : "";
}

/** The close answers on a line of their own, under a score („1 близо“): no dot to start the line; "" for none. */
export function closeLine(trail: Mark[] = []): string {
  const n = closeCount(trail);
  return n ? `${n} близо` : "";
}

/** How many of a run's answers were close („близо“), not right, of those that count. */
const closeCount = (trail: Mark[]) => trail.filter((m) => m?.close && !m.right && !m.void).length;

/** The share of players right at or under which a right answer is a rare one, told in gold: a quarter. */
export const rare = 0.25;

/** A crowd as the player sees it with their answer: the others' (as the server counts them: the day's are the others',
 * and everyone's ever has this answer only once it's counted again), with the player's own answer counted in — `mine`,
 * the place of the option they picked (-1: none, or a kind without options), and whether it was right — so that what
 * they picked never reads „0%“, and the shares and the line under them add up. */
export function withOwn(c: Crowd, mine: number, right: boolean): Crowd {
  const n = c.answers;
  const picks = c.picks?.map((x, i) => (x * n + (i === mine ? 1 : 0)) / (n + 1));
  return { ...c, answers: n + 1, right: (c.right * n + (right ? 1 : 0)) / (n + 1), picks };
}

/** A count with its noun, one or many, in Bulgarian digits: „1 ден“, „12 дни“, „1 234 отговора“. */
export const count = (n: number, one: string, many: string) =>
  `${new Intl.NumberFormat("bg", { useGrouping: n >= 10000 }).format(n)} ${n === 1 ? one : many}`;
