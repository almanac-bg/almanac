// The day's result as it's shared: no answers and no words of invitation, only how it went, a square for each question
// (the one place the game uses emoji: in the text shared, never on a screen) and where it's played: the player's own
// link, which brings whoever opens it to the day and offers them the player's friendship (screens/invite.ts).

import { issueWords } from "../lib/words.ts";
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

/** The share of players right at or under which a right answer is a rare one, told and shared: a quarter. */
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

/** The day's result to share: „АЛМАНАХ · Брой 3 · 14 ноември“ (the day's issue, play/issue.go), „8 от 10 · серия 12“
 * (the streak from two days), a square for each of the ten that counts (🟩 right, 🟨 close, ⬜ wrong or not answered; one
 * that counts for nobody, Mark.void, has none, and the result is out of the others), the right
 * answer the fewest of the day's other players got, if few did (`rarest`: its place and their share right: „Познах
 * въпрос 7, който знаят само 12%“), and the player's link (their invite), or „almanac.bg“ without one. `day` is
 * YYYY-MM-DD. */
export function dayShareText(
  day: string,
  issue: number | undefined,
  trail: Mark[],
  total: number,
  streak: number,
  rarest?: { n: number; right: number } | null,
  link = "almanac.bg",
): string {
  const counted = Array.from({ length: total }, (_, i) => trail[i]).filter((m) => !m?.void);
  const rights = counted.filter((m) => m?.right).length;
  const squares = counted.map((m) => (m?.right ? "🟩" : m?.partial ? "🟨" : "⬜")).join("");
  const few =
    rarest && rarest.right <= rare
      ? `Познах въпрос ${rarest.n + 1}, който ${rarest.right ? `знаят само ${percent(rarest.right)}` : "не знае никой друг"}`
      : "";
  return [
    `АЛМАНАХ · ${issueWords(issue, day)}`,
    streak > 1 ? `${rights} от ${counted.length} · серия ${streak}` : `${rights} от ${counted.length}`,
    squares,
    few,
    link,
  ]
    .filter(Boolean)
    .join("\n");
}

/** A duel's win as it's shared, in the day's way: „АЛМАНАХ · Дуел“, „Победа 5820 : 1900 · 6 от 10 верни“ (the
 * points, as the duel was won), and the player's own link (their invite: screens/invite.ts) beside it. No names, the
 * other's least of all, and no words of invitation. */
export function duelShareText(mine: number, theirs: number, rights: number, total = 10): string {
  const n = (x: number) => new Intl.NumberFormat("bg", { useGrouping: x >= 10000 }).format(x);
  return `АЛМАНАХ · Дуел\nПобеда ${n(mine)} : ${n(theirs)} · ${rights} от ${total} верни`;
}

/** A count with its noun, one or many, in Bulgarian digits: „1 ден“, „12 дни“, „1 234 отговора“. */
export const count = (n: number, one: string, many: string) =>
  `${new Intl.NumberFormat("bg", { useGrouping: n >= 10000 }).format(n)} ${n === 1 ? one : many}`;

/** A year in the game, as it's shared: the days and streak, the answers and the share right, the strongest topic
 * and the facts learned, and where it's played. */
export function yearShareText(y: {
  year: number;
  days: number;
  streak: number;
  answers: number;
  right: number;
  topic?: string;
  facts: number;
}): string {
  const share = y.answers ? Math.round((100 * y.right) / y.answers) : 0;
  return [
    `Моята ${y.year} в АЛМАНАХ`,
    `${count(y.days, "ден", "дни")} игра${y.streak > 1 ? ` · серия ${y.streak}` : ""}`,
    `${count(y.answers, "отговор", "отговора")}, ${share}% верни`,
    y.topic ? `Най-силна тема: ${y.topic}` : "",
    y.facts ? `${count(y.facts, "факт", "факта")} в Алманаха` : "",
    "almanac.bg",
  ]
    .filter(Boolean)
    .join("\n");
}
