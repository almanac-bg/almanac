// The one gold action after the day's ten (DESIGN.md: one obvious action a screen): another game, of the topic the
// player has played least. Kept apart from the screens so that the rule can be tested on its own.

/** A topic as the player has played it: its answers so far (play.Mastery). */
export interface Played {
  category: string;
  answers: number;
}

/** Where another game goes: the topic the player has answered fewest questions of (`mine`, from Профил's numbers), the
 * first of the bank's `topics` among those level; „Микс“ while nothing says (no numbers yet). The answers are what the
 * game itself counts for each topic, so „least played“ is true to the player, and leads them round the whole book. */
export function nextGame(mine: Played[] | undefined, topics: string[]): string {
  if (!mine?.length || !topics.length) return "/play/mix";
  const answers = (id: string) => mine.find((m) => m.category === id)?.answers ?? 0;
  let least = topics[0] ?? "";
  for (const id of topics) if (answers(id) < answers(least)) least = id;
  return `/play/${least}`;
}
