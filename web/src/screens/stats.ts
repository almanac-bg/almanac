// How a player has done: the streak and this week, their numbers, their strongest topics, their latest games.

import type { Board } from "../game/types.ts";
import { api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { categories } from "../state.ts";
import { games, level, questions, ring, stat, streak, toneOf } from "../ui.ts";

export interface TopicStats {
  category: string;
  answers: number;
  right: number;
}

export interface Stats {
  streak: number;
  week: boolean[];
  days: number;
  games: number;
  answers: number;
  right: number;
  duels: number;
  won: number;
  topics: TopicStats[];
  recent: {
    id: number;
    kind: "day" | "topic" | "challenge" | "duel";
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
    case "challenge":
      return "Предизвикателство";
    case "duel":
      return `Дуел срещу ${p.opponent}${p.recorded ? " (запис)" : ""}, ${outcome[p.outcome ?? "draw"]}`;
    default:
      return topicName(p.category);
  }
}

export function stats(): Child {
  const data = signal<Stats | null>(null);
  const day = signal<Board | null>(null);
  loadStats().then(data.set, () => {});
  api<{ board: Board }>("GET", "/api/day").then(
    (t) => day.set(t.board),
    () => {},
  );
  return () => {
    const s = data();
    if (!s) return null;
    if (s.games === 0) return [streak(s.streak, s.week), h("p", { class: "muted" }, "Още няма изиграни игри.")];
    const place = day()?.place;
    // The strongest topics: those played enough to tell, best first.
    const strongest = s.topics
      .map((t) => ({ t, l: level(t.right, t.answers) }))
      .filter((x) => x.l)
      .sort((a, b) => (b.l?.percent ?? 0) - (a.l?.percent ?? 0))
      .slice(0, 3);
    return [
      h("p", { class: "muted" }, `${games(s.games)} · ${questions(s.answers)}`),
      streak(s.streak, s.week),
      h(
        "div",
        { class: "stats" },
        place ? stat(`${place}-и`, "място днес", "gold") : stat(String(s.days), "дни с въпросите на деня", "gold"),
        stat(`${percent(s.right, s.answers)}%`, "верни отговора", "mint"),
        s.duels > 0 ? stat(`${s.won}/${s.duels}`, "спечелени дуела", "rose") : stat(String(s.answers), "отговора"),
        stat(String(s.games), "изиграни игри"),
      ),
      strongest.length
        ? h(
            "section",
            { class: "card" },
            h("h2", { class: "section-title" }, "Най-силни теми"),
            h(
              "div",
              { class: "rings" },
              strongest.map(({ t, l }) => ring(l?.percent ?? 0, topicName(t.category), toneOf(t.category))),
            ),
          )
        : null,
      h(
        "section",
        { class: "stack" },
        h("h2", { class: "section-title" }, "Последни игри"),
        h(
          "ol",
          { class: "games" },
          s.recent.map((p) =>
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
