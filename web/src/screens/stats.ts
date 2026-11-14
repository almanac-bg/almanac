// How a player has done: the streak and this week, their numbers, how well they know each topic, their latest games.

import { type Mastery, masteryCard } from "../game/mastery.ts";
import { api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { categories } from "../state.ts";
import { figure, formatNumber, streak } from "../ui.ts";

export interface Stats {
  streak: number;
  week: boolean[];
  saved: boolean[];
  reserve: number;
  days: number;
  games: number;
  answers: number;
  right: number;
  duels: number;
  won: number;
  mastery: Mastery[];
  recent: {
    id: number;
    kind: "day" | "topic" | "challenge" | "duel" | "royal" | "mistakes"; // challenge: from when there were challenges
    day?: string;
    category?: string;
    rights: number;
    total: number;
    points: number;
    at: number;
    opponent?: string;
    recorded?: boolean;
    outcome?: "won" | "lost" | "draw";
  }[];
}

export const loadStats = () => api<Stats>("GET", "/api/me/stats");

const percent = (right: number, of: number) => (of ? Math.round((100 * right) / of) : 0);
const topicName = (id?: string) => (id ? (categories.find((c) => c.id === id)?.name ?? id) : "Всички теми");
const date = (ms: number) => new Intl.DateTimeFormat("bg", { day: "numeric", month: "long" }).format(new Date(ms));
const outcome = { won: "победа", lost: "загуба", draw: "равенство" };

function what(p: Stats["recent"][number]): string {
  switch (p.kind) {
    case "day":
      return "Въпросите на деня";
    case "duel":
      // A friend's challenge has its opponent and result once both have played: until then (or if it was declined or
      // ran out), only that it was a duel.
      return p.outcome ? `Дуел срещу ${p.opponent}${p.recorded ? " (запис)" : ""}, ${outcome[p.outcome]}` : "Дуел";
    case "royal":
      return "Роял";
    case "mistakes":
      return "Втори шанс";
    default:
      return topicName(p.category);
  }
}

/** Профил's numbers: the streak and this week; how well and how much they've played, in one card (the day's place
 * is Начало's and Класации'); how well they know each topic; their latest games. */
export function stats(): Child {
  const data = signal<Stats | null>(null);
  loadStats().then(data.set, () => {});
  return () => {
    const s = data();
    if (!s) return null;
    if (s.games === 0)
      return [streak(s.streak, s.week, s.saved, s.reserve), h("p", { class: "muted" }, "Още няма изиграни игри.")];
    return [
      streak(s.streak, s.week, s.saved, s.reserve),
      h(
        "section",
        { class: "card figures" },
        figure(
          `${percent(s.right, s.answers)}%`,
          `верни от ${formatNumber(s.answers)} ${s.answers === 1 ? "отговор" : "отговора"}`,
        ),
        figure(String(s.games), s.games === 1 ? "изиграна игра" : "изиграни игри"),
        s.duels > 0
          ? figure(`${s.won}/${s.duels}`, "спечелени дуела")
          : figure(String(s.days), s.days === 1 ? "ден с въпросите на деня" : "дни с въпросите на деня"),
      ),
      masteryCard(s.mastery),
      h(
        "section",
        { class: "stack" },
        h("h2", { class: "section-title" }, "Последни игри"),
        h(
          "ol",
          { class: "games" },
          s.recent
            .slice(0, 5)
            .map((p) =>
              h(
                "li",
                { class: "game" },
                h(
                  "div",
                  { class: "game-text" },
                  h("strong", { class: "game-what" }, what(p)),
                  h("span", { class: "game-when" }, date(p.at)),
                ),
                h("b", { class: "game-score" }, `${p.rights} от ${p.total}`),
              ),
            ),
        ),
      ),
    ];
  };
}
