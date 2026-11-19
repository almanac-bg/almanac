// The one gold action after the day's ten (DESIGN.md: one obvious action a screen): another game, where a goal of the
// day points. Kept apart from the screens so that the rule can be tested on its own.

/** The streak's round numbers (the achievements' and a year): reached, they're the game's big news. */
export const streakMarks = [3, 7, 30, 100, 365];

/** A goal of the day as the gold action reads it. */
export interface OpenGoal {
  href?: string;
  done: boolean;
}

/** Where another game goes: the first open goal that's a game of a topic, else `otherwise` (a topic). */
export function nextGame(goals: OpenGoal[], otherwise: string): string {
  return goals.find((g) => !g.done && g.href?.startsWith("/play/"))?.href ?? otherwise;
}
