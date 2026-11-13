// Класации: where players stand — today's questions for everyone, and among friends.

import { board } from "../game/results.ts";
import type { Board, Score } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { title } from "../lib/router.ts";

interface Day {
  board: Board;
  friends?: Score[] | null;
}

export function ranks() {
  title("Класации");
  const day = signal<Day | null>(null);
  const error = signal("");
  api<Day>("GET", "/api/day").then(day.set, (err) => error.set((err as ApiError).message));
  return h("section", { class: "screen" }, h("h1", null, "Класации"), (): Child => {
    const d = day();
    if (error()) return h("p", { role: "alert" }, error());
    if (!d) return h("p", { class: "muted" }, "…");
    return [
      d.friends?.length ? board("Приятели днес", d.friends) : null,
      d.board.top.length
        ? board("Днес", d.board.top, d.board.place, d.board.mine)
        : h("p", { class: "muted" }, "Днес още никой не е изиграл въпросите на деня."),
    ];
  });
}
