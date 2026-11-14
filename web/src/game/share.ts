// The day's result as it's shared: no answers and no invitation, only how it went, a square for each question (the
// one place the game uses emoji: in the text shared, never on a screen) and where it's played.

import type { Mark } from "./types.ts";

const months = [
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
];

/** The day's result to share: „АЛМАНАХ · 14 ноември“, „8 от 10 · серия 12“ (the streak from two days), a square for
 * each of the ten (🟩 right, 🟨 close, 🟥 wrong or not answered) and „almanac.bg“. `day` is YYYY-MM-DD. */
export function dayShareText(day: string, trail: Mark[], total: number, streak: number): string {
  const [, month = 1, date = 1] = day.split("-").map(Number);
  const rights = trail.filter((m) => m.right).length;
  const squares = Array.from({ length: total }, (_, i) => {
    const m = trail[i];
    return m?.right ? "🟩" : m?.partial ? "🟨" : "🟥";
  }).join("");
  return [
    `АЛМАНАХ · ${date} ${months[month - 1]}`,
    streak > 1 ? `${rights} от ${total} · серия ${streak}` : `${rights} от ${total}`,
    squares,
    "almanac.bg",
  ].join("\n");
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
