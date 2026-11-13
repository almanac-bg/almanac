// Класации: where players stand — by rating (with their division), by this week's points, and on today's
// questions (everyone, and among friends).

import { emblem } from "../art/emblem.ts";
import { board, boardRow } from "../game/results.ts";
import type { Board, Score } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import type { Tier } from "../ui.ts";
import type { Standing } from "./duel.ts";

interface Ranked {
  name: string;
  tag: string;
  value: number;
  division?: Standing["division"];
  me?: boolean;
  avatar?: string;
  title?: string;
  titleTier?: Tier;
  level?: number;
}

interface Ranking {
  top: Ranked[];
  place?: number;
  mine?: Ranked;
}

interface Day {
  board: Board;
  friends?: Score[] | null;
}

type Tab = "rating" | "week" | "day";

const tabs: [Tab, string][] = [
  ["rating", "Рейтинг"],
  ["week", "Седмица"],
  ["day", "Днес"],
];

export function ranks() {
  title("Класации");
  const tab = signal<Tab>("rating");
  const boards = signal<{ rating: Ranking; week: Ranking } | null>(null);
  const day = signal<Day | null>(null);
  const error = signal("");
  api<{ rating: Ranking; week: Ranking }>("GET", "/api/ranks").then(boards.set, (err) =>
    error.set((err as ApiError).message),
  );
  api<Day>("GET", "/api/day").then(day.set, () => {});
  return h(
    "section",
    { class: "screen" },
    h("h1", null, "Класации"),
    h(
      "div",
      { class: "segmented", role: "tablist", "aria-label": "Класации" },
      tabs.map(([id, label]) =>
        h(
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": () => tab() === id,
            onclick: () => tab.set(id),
          },
          label,
        ),
      ),
    ),
    (): Child => {
      if (error()) return h("p", { role: "alert" }, error());
      const t = tab();
      if (t === "day") {
        const d = day();
        if (!d) return h("p", { class: "muted" }, "…");
        return [
          d.friends?.length ? board("Приятели днес", d.friends) : null,
          d.board.top.length
            ? board("Днес", d.board.top, d.board.place, d.board.mine)
            : h("p", { class: "muted" }, "Днес още никой не е изиграл въпросите на деня."),
        ];
      }
      const b = boards();
      if (!b) return h("p", { class: "muted" }, "…");
      return t === "rating"
        ? ranking(
            "Рейтинг",
            b.rating,
            (r) => [r.division ? emblem(r.division.id, "s") : null, String(r.value)],
            "Още никой няма рейтинг: той идва с първия дуел.",
          )
        : ranking("Тази седмица", b.week, (r) => `${r.value} т.`, "Тази седмица още никой не е играл.");
    },
  );
}

/** A board: the best, and the viewer's own row (below a gap) if they're further down. */
function ranking(heading: string, r: Ranking, score: (x: Ranked) => Child, empty: string): Child {
  if (!r.top.length) return h("p", { class: "muted" }, empty);
  const inTop = r.top.some((x) => x.me);
  return h(
    "section",
    { class: "board" },
    h("h2", null, heading),
    h(
      "ol",
      null,
      r.top.map((x, i) => boardRow(i + 1, x.name, score(x), { me: x.me, look: x })),
      !inTop && r.mine && r.place
        ? boardRow(r.place, r.mine.name, score(r.mine), { me: true, gap: true, look: r.mine })
        : null,
    ),
  );
}
