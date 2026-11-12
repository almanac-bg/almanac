// The end of a run: how it went, the way to share it, and the questions gone over with their answers.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { categories } from "../state.ts";
import { answered, picture } from "./questions.ts";
import { report } from "./report.ts";
import { trail } from "./run.ts";
import type { Mark, Reviewed, Score, State } from "./types.ts";

export function summary(s: State, ...more: Child[]): Child {
  return h(
    "section",
    { class: "summary" },
    h("h1", null, `${s.rights} от ${s.total}`),
    h("p", { class: "muted" }, `${s.points} точки`),
    trail(s.trail, s.total),
    more,
    review(s.id),
  );
}

/** The marks as squares, for sharing as text. */
export function squares(marks: Mark[]): string {
  return marks.map((m) => (m.right ? "🟩" : m.partial ? "🟨" : "⬛")).join("");
}

/** Shares through the phone's own sheet, or copies where there's none. */
export function shareButton(label: string, text: () => string, url?: string): Child {
  const done = signal("");
  return h(
    "div",
    { class: "share" },
    h(
      "button",
      {
        class: "btn",
        onclick: async () => {
          const body = text();
          if (navigator.share) {
            try {
              await navigator.share({ text: body, url });
              return;
            } catch (err) {
              if ((err as DOMException).name === "AbortError") return;
            }
          }
          try {
            await navigator.clipboard.writeText(url ? `${body}\n${url}` : body);
            done.set("Копирано.");
          } catch {
            done.set(url ?? body);
          }
        },
      },
      label,
    ),
    () => done() && h("p", { class: "muted", role: "status" }, done()),
  );
}

/** Going over the run: each question, the answer, and what was given. */
function review(id: number): Child {
  const items = signal<Reviewed[] | null>(null);
  const error = signal("");
  const open = async () => {
    try {
      items.set((await api<{ questions: Reviewed[] }>("GET", `/api/runs/${id}/review`)).questions);
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };
  return h("section", { class: "review" }, () => {
    const list = items();
    if (!list) {
      return h(
        "div",
        { class: "stack" },
        h("button", { class: "link", onclick: open }, "Виж въпросите и отговорите"),
        error() && h("p", { class: "bad" }, error()),
      );
    }
    return [
      h("h2", null, "Въпросите"),
      list.map((it) =>
        h(
          "article",
          { class: "reviewed" },
          h(
            "p",
            { class: "muted" },
            `${it.n + 1}. ${categories.find((c) => c.id === it.category)?.name ?? ""} · ${it.points} т.`,
          ),
          h("h3", null, it.view.text),
          picture(it.view),
          answered(it.view, it.reveal, it.given),
          it.reveal.fact ? h("p", { class: "fact" }, it.reveal.fact) : null,
          report(it.reveal.id),
        ),
      ),
    ];
  });
}

/** A board of results: the best, and the viewer among them. */
export function board(title: string, scores: Score[], place?: number, mine?: Score): Child {
  const rows = [...scores];
  return h(
    "section",
    { class: "board" },
    h("h2", null, title),
    h(
      "ol",
      null,
      rows.map((s, i) =>
        h(
          "li",
          { class: s.me ? "row me" : "row" },
          h("span", { class: "place" }, String(i + 1)),
          h("span", { class: "who" }, s.name),
          h("span", { class: "pts" }, `${s.rights}/10 · ${s.points}`),
        ),
      ),
      place && mine && !rows.some((s) => s.me)
        ? h(
            "li",
            { class: "row me" },
            h("span", { class: "place" }, String(place)),
            h("span", { class: "who" }, mine.name),
            h("span", { class: "pts" }, `${mine.rights}/10 · ${mine.points}`),
          )
        : null,
    ),
  );
}
