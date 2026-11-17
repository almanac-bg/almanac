// A topic's mastery as the server sends it (play/mastery.go), and which of a game's moves of it are news: kept apart
// from how it's drawn (mastery.ts), so that the rule can be tested on its own.

export interface Mastery {
  category: string;
  answers: number;
  known: number; // percent of the topic's questions
  tier: number; // 0 (Новак) … TIERS - 1 (Светило)
  name: string;
  next?: string;
  nextAt?: number;
  sure: boolean; // answers enough to tell, with its tier: until then it's a guess
  first?: boolean; // answers enough for a first estimate, not yet sure: its share is told, never its tier
}

export interface MasteryMove {
  from: Mastery;
  to: Mastery;
}

/** Whether a game's move of a topic's mastery is news: a first estimate, a tier told for the first time, a share gone
 * up. A share gone down isn't news, and „Ново за теб“ is no place for a loss: Профил has it. */
export function masteryNews(m: MasteryMove): boolean {
  const shown = (x: Mastery) => x.sure || !!x.first;
  if (!shown(m.to)) return false;
  return !shown(m.from) || (m.to.sure && !m.from.sure) || m.to.known > m.from.known;
}
