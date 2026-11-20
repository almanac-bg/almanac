// Where the day played leaves a player among everyone who played it, as Начало says it under the result. A place is a
// way to the day's board, but not every place is worth leading with: a new player's first social signal shouldn't be
// „30-о място от 31“ (the day goes from easy to hard, so a poor first day is common), and among thousands „4312-о
// място“ says nothing. So, on a player's first day (no game finished before it), the place shows only in the better
// half (or first); otherwise the way to the board is plain, „Класацията на деня“, and from ten players a share says how
// it went, „По-добре от 35% от играчите днес.“ From a hundred players a day the share leads for everyone, and the place
// stays the way to the board.

import { place } from "../lib/ordinal.ts";

/** The day's standing as Начало says it: the place, where it's worth saying („41-во място от 312“: the way to the day's
 * board; else that way is plain, „Класацията на деня“), and a line about it (`lead`), if any. */
export interface Standing {
  place?: string;
  lead?: string;
}

/** From how many players a share of them is worth saying; and from how many it leads, the place a way to the board. */
export const shareFrom = 10;
export const shareLeads = 100;

/** The standing of a player in `at` place of `players` (`early`: on their first day); null without
 * someone to be placed among: „1-во място от 1“ says nothing. */
export function standing(at: number | undefined, players: number, early: boolean): Standing | null {
  if (!at || players < 2) return null;
  const shown = !early || at === 1 || 2 * at <= players;
  // Better than how many of the others, rounded down: never more than it was.
  const better = Math.floor((100 * (players - at)) / (players - 1));
  const share = at > 1 && better > 0 && players >= shareFrom && (players >= shareLeads || !shown);
  return {
    place: shown ? place(at, players) : undefined,
    lead: share ? `По-добре от ${better}\u00a0% от играчите днес.` : undefined,
  };
}
