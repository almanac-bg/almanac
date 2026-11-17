// The one gold action after the day's ten (DESIGN.md: one obvious action a screen), decided by what's worth doing
// next: sharing a result worth sharing, once a day; winning a broken streak back; or another game, where a goal of the
// day points. Kept apart from the screens so that the rule can be tested on its own.

/** The day's result as the gold action weighs it. */
export interface DayDone {
  /** Right answers of ten. */
  rights: number;
  /** The streak with today in it. */
  streak: number;
  /** A right answer few of the day's other players got (share.ts's rare), if known. */
  rare: boolean;
  /** The day's result was shared already, today. */
  shared: boolean;
  /** A broken streak is half won back: the day's ten played, another game still to play (play/repair.go). */
  repairing: boolean;
}

/** What the gold action under the day's result is: „Сподели“; the repair's „Още една игра“ (in its card: the result
 * has no gold then); or another game („Още десет“). */
export type DayGold = "share" | "repair" | "next";

/** A result is worth sharing with 6 of 10 or more, with a streak of 3 days or more, or with a right answer few got. */
export const worthSharing = (d: DayDone): boolean => d.rights >= 6 || d.streak >= 3 || d.rare;

export function dayGold(d: DayDone): DayGold {
  if (d.repairing) return "repair";
  if (!d.shared && worthSharing(d)) return "share";
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
