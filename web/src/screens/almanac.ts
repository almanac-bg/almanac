// Моят Алманах: what the player has learned — the fact behind every question they've answered right, by topic.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { categories, user } from "../state.ts";
import { fact, meter, toneOf } from "../ui.ts";

interface Learned {
  id: string;
  category: string;
  question: string;
  answer: string;
  fact: string;
  at: number;
}

export function almanac() {
  title("Моят Алманах");
  const data = signal<{ facts: Learned[]; of: Record<string, number> } | null>(null);
  const topic = signal("");
  const error = signal("");
  if (user.peek())
    api<{ facts: Learned[]; of: Record<string, number> }>("GET", "/api/almanac").then(data.set, (err) =>
      error.set((err as ApiError).message),
    );
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("h1", null, "Моят Алманах"),
      h("p", { class: "lead" }, "Всичко, което научи: фактът зад всеки въпрос, на който отговори вярно."),
    ),
    (): Child => {
      if (error()) return h("p", { role: "alert" }, error());
      const d = data();
      if (!user()) return h("p", { class: "muted" }, "Изиграй първите си въпроси и фактите ще се събират тук.");
      if (!d) return h("p", { class: "muted" }, "…");
      const all = Object.values(d.of).reduce((a, b) => a + b, 0);
      const shown = topic() ? d.facts.filter((f) => f.category === topic()) : d.facts;
      return [
        h(
          "div",
          { class: "card almanac-head" },
          h("b", { class: "almanac-n" }, String(d.facts.length)),
          h("span", { class: "muted" }, `от ${all} факта`),
          meter(all ? Math.round((100 * d.facts.length) / all) : 0, `${d.facts.length} от ${all} факта`),
        ),
        h(
          "ul",
          { class: "chips" },
          h(
            "li",
            null,
            h(
              "button",
              { class: "chip", type: "button", "aria-pressed": () => !topic(), onclick: () => topic.set("") },
              "Всички",
            ),
          ),
          categories.map((c) => {
            const n = d.facts.filter((f) => f.category === c.id).length;
            return h(
              "li",
              null,
              h(
                "button",
                {
                  class: `chip ${toneOf(c.id)}`,
                  type: "button",
                  "aria-pressed": () => topic() === c.id,
                  onclick: () => topic.set(c.id),
                },
                h("span", { class: "dot", "aria-hidden": "true" }),
                `${c.name} · ${n}/${d.of[c.id] ?? 0}`,
              ),
            );
          }),
        ),
        shown.length
          ? h(
              "ol",
              { class: "almanac-list" },
              shown.map((f) =>
                h(
                  "li",
                  { class: `card almanac-item ${toneOf(f.category)}` },
                  h("p", { class: "kicker" }, categories.find((c) => c.id === f.category)?.name ?? ""),
                  h("p", { class: "almanac-q" }, f.question),
                  h("p", { class: "almanac-a" }, f.answer),
                  fact(f.fact),
                ),
              ),
            )
          : h("p", { class: "muted" }, "Тук още няма факти. Отговори вярно на въпрос от тази тема и ще дойдат."),
      ];
    },
  );
}
