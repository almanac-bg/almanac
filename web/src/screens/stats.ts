// How a player has done: the streak, what they've played, how well in each topic, their latest games.

import { api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { categories } from "../state.ts";

interface Stats {
  streak: number;
  days: number;
  games: number;
  answers: number;
  right: number;
  duels: number;
  won: number;
  topics: { category: string; answers: number; right: number }[];
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

const percent = (right: number, of: number) => (of ? `${Math.round((100 * right) / of)}%` : "—");
const topicName = (id?: string) => (id ? (categories.find((c) => c.id === id)?.name ?? id) : "Всички теми");
const date = (ms: number) => new Intl.DateTimeFormat("bg", { day: "numeric", month: "long" }).format(new Date(ms));

export function stats(): Child {
  const data = signal<Stats | null>(null);
  api<Stats>("GET", "/api/me/stats").then(data.set, () => {});
  return () => {
    const s = data();
    if (!s) return null;
    if (s.games === 0) return h("p", { class: "muted" }, "Още няма изиграни игри.");
    const outcome = { won: "победа", lost: "загуба", draw: "равенство" };
    const what = (p: Stats["recent"][number]) =>
      p.kind === "day"
        ? "Въпросите на деня"
        : p.kind === "challenge"
          ? "Предизвикателство"
          : p.kind === "duel"
            ? `Дуел срещу ${p.opponent}${p.recorded ? " (запис)" : ""}, ${outcome[p.outcome ?? "draw"]}`
            : topicName(p.category);
    return h(
      "section",
      { class: "stack" },
      h("h2", null, "Как се справяш"),
      h(
        "p",
        null,
        s.streak > 0 ? `Серия: ${s.streak} ${s.streak === 1 ? "ден" : "дни"}. ` : "",
        `${s.games} ${s.games === 1 ? "игра" : "игри"}, ${s.answers} въпроса, ${percent(s.right, s.answers)} верни.`,
        s.duels > 0 ? ` Дуели: ${s.won} ${s.won === 1 ? "победа" : "победи"} от ${s.duels}.` : "",
      ),
      h(
        "table",
        { class: "stats" },
        h("thead", null, h("tr", null, h("th", null, "Тема"), h("th", null, "Въпроси"), h("th", null, "Верни"))),
        h(
          "tbody",
          null,
          s.topics.map((t) =>
            h(
              "tr",
              null,
              h("td", null, topicName(t.category)),
              h("td", null, String(t.answers)),
              h("td", null, percent(t.right, t.answers)),
            ),
          ),
        ),
      ),
      h("h2", null, "Последни игри"),
      h(
        "ol",
        { class: "recent" },
        s.recent.map((p) => h("li", null, `${date(p.at)} · ${what(p)} · ${p.rights} от ${p.total}`)),
      ),
    );
  };
}
