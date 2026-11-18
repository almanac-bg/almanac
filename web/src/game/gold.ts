// The one gold action after the day's ten (DESIGN.md: one obvious action a screen), decided by what's worth doing
// next: sharing a result worth sharing, as it lands; winning a broken streak back; or another game, where a goal of the
// day points. Kept apart from the screens so that the rule can be tested on its own.

/** The day's result as the gold action weighs it. */
export interface DayDone {
  /** Right answers of ten. */
  rights: number;
  /** The streak with today in it. */
  streak: number;
  /** A right answer few of the day's other players got (share.ts's rare), if known. */
  rare: boolean;
  /** Played this moment: the result lands now. A later visit finds it played, and another game is what's next. */
  just: boolean;
  /** A broken streak is half won back: the day's ten played, another game still to play (play/repair.go). */
  repairing: boolean;
}

/** What the gold action under the day's result is: „Сподели“; the repair's „Още една игра“ (in its card: the result
 * has no gold then); or another game („Още десет“). */
export type DayGold = "share" | "repair" | "next";

/** The streak's round numbers (the achievements' and a year): reached, they're the game's big news, worth a share. */
export const streakMarks = [3, 7, 30, 100, 365];

/** A result is worth sharing with 6 of 10 or more, with the streak on a round number, or with a right answer few got
 * among 4 or more (one lucky answer in a 2 of 10 is no result to show). */
export const worthSharing = (d: DayDone): boolean =>
  d.rights >= 6 || streakMarks.includes(d.streak) || (d.rare && d.rights >= 4);

export function dayGold(d: DayDone): DayGold {
  if (d.repairing) return "repair";
  if (d.just && worthSharing(d)) return "share";
  return "next";
}

/** A goal of the day as the gold action reads it. */
export interface OpenGoal {
  href?: string;
  done: boolean;
}

/** Where another game goes: the first open goal that's a game of topics (its topic, or all of them), else all the
 * topics. */
export function nextGame(goals: OpenGoal[]): string {
  return goals.find((g) => !g.done && g.href?.startsWith("/play/"))?.href ?? "/play/all";
}
