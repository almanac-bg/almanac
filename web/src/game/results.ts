// The end of a run: how it went, the way to share it, and the questions gone over with their answers.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { categories } from "../state.ts";
import { fact, type Look, who } from "../ui.ts";
import { answered, picture } from "./questions.ts";
import { report } from "./report.ts";
import { trail } from "./run.ts";
import type { Reviewed, Score, State } from "./types.ts";

/** A finished run: the score as the screen's big number, its points, a line about it (the place), and the marks;
 * then whatever the screen adds, and the questions to go over. */
export function summary(s: State, line: Child, ...more: Child[]): Child {
  return h(
    "section",
    { class: "summary" },
    h(
      "div",
      { class: "card hero" },
      h(
        "div",
        { class: "score-row" },
        h(
          "h1",
          { class: "score" },
          h("b", { class: "score-n" }, String(s.rights)),
          h("span", { class: "score-of" }, ` от ${s.total}`),
        ),
        h(
          "p",
          { class: "points" },
          h("b", { class: "points-n" }, String(s.points)),
          h("span", { class: "points-label" }, s.points === 1 ? "точка" : "точки"),
        ),
      ),
      line,
      trail(s.trail, s.total),
    ),
    more,
    review(async () => (await api<{ questions: Reviewed[] }>("GET", `/api/runs/${s.id}/review`)).questions),
  );
}

/** Shares through the phone's own sheet, or copies where there's none. */
export function shareButton(label: string, text: () => string, url?: string, primary = true): Child {
  const done = signal("");
  return h(
    "div",
    { class: "share" },
    h(
      "button",
      {
        class: primary ? "btn primary big" : "btn",
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

/** Going over a game, once it's over: each question, the answer, what was given, the fact behind it, and a word
 * about the question if something's wrong with it. */
export function review(load: () => Promise<Reviewed[]>): Child {
  const items = signal<Reviewed[] | null>(null);
  const error = signal("");
  const open = async () => {
    try {
      items.set(await load());
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
        h("button", { class: "btn", onclick: open }, "Въпросите, отговорите и „Знаеше ли?“"),
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
            { class: "kicker" },
            `${it.n + 1} · ${categories.find((c) => c.id === it.category)?.name ?? ""} · ${it.points} т.`,
          ),
          h("h3", { class: "ask" }, it.view.text),
          picture(it.view),
          answered(it.view, it.reveal, it.given),
          it.reveal.fact ? fact(it.reveal.fact) : null,
          report(it.reveal.id),
        ),
      ),
    ];
  });
}

/** One row of a board: the place (gold, silver, bronze for the first three), the player with their look, the
 * score. */
export function boardRow(
  place: number,
  name: string,
  score: Child,
  opts: { me?: boolean; gap?: boolean; look?: Look; tag?: string } = {},
) {
  const cls = ["row", place <= 3 && `p${place}`, opts.me && "me", opts.gap && "gap"].filter(Boolean).join(" ");
  return h(
    "li",
    { class: cls },
    h("span", { class: "place" }, String(place)),
    who(name, opts.look, opts.me ? h("span", { class: "you" }, "ти") : null, name, opts.tag),
    h("span", { class: "pts" }, score),
  );
}

const scoreOf = (s: Score) => [h("small", { class: "sub" }, `${s.rights}/10 · `), String(s.points)];

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
      rows.map((s, i) => boardRow(i + 1, s.name, scoreOf(s), { me: s.me, look: s, tag: s.tag })),
      place && mine && !rows.some((s) => s.me)
        ? boardRow(place, mine.name, scoreOf(mine), {
            me: true,
            gap: place > rows.length + 1,
            look: mine,
            tag: mine.tag,
          })
        : null,
    ),
  );
}
