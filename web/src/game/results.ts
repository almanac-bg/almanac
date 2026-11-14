// The end of a game: how it went, then what to do next (the way to share it, the questions to go over with their
// answers), laid out the same on every result screen.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { calm } from "../lib/prefs.ts";
import { categories } from "../state.ts";
import { countUp, fact, formatNumber, type Look, who } from "../ui.ts";
import { answered, picture } from "./questions.ts";
import { report } from "./report.ts";
import { trail } from "./run.ts";
import type { Reviewed, Score, State } from "./types.ts";

/** A finished run: the score as the screen's big number, its points, a line about it (the place), and the marks;
 * right under it what to do next (`next`: the gold action, then „Прегледай въпросите“ and the others); then
 * whatever the screen adds (`more`: what the game earned); and at the end, once opened, the questions. */
export function summary(s: State, line: Child, next: { main: Child; also?: Child[] }, more: Child[] = []): Child {
  const questions = reviewParts(
    async () => (await api<{ questions: Reviewed[] }>("GET", `/api/runs/${s.id}/review`)).questions,
  );
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
          h("b", { class: "points-n" }, countUp(s.points)),
          h("span", { class: "points-label" }, s.points === 1 ? "точка" : "точки"),
          s.allRight ? h("span", { class: "points-bonus" }, `+${formatNumber(s.allRight)} за всички верни`) : null,
        ),
      ),
      line,
      trail(s.trail, s.total),
    ),
    nextSteps(next.main, [questions.button, ...(next.also ?? [])]),
    more,
    questions.list,
  );
}

/** What to do after a game, right under its result: the one gold action, then the others, plain and the same size,
 * side by side where they fit. */
export function nextSteps(main: Child, others: Child[]): Child {
  const rest = others.filter(Boolean);
  return h("div", { class: "actions" }, main, rest.length ? h("div", { class: "result-actions" }, rest) : null);
}

/** Shares through the phone's own sheet, or copies where there's none (`url`, if any, goes with the text). */
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
 * about the question if something's wrong with it, opened right under the button (which goes once they're open). */
export function review(load: () => Promise<Reviewed[]>): Child {
  const { button, list, opened } = reviewParts(load);
  return h("section", { class: "review" }, () => (opened() ? null : button), list);
}

/** The questions of a game to go over, in two parts: the button, kept with the other ways on under the result, and
 * the list it opens, kept for the end of the screen; the button takes the player there. */
export function reviewParts(load: () => Promise<Reviewed[]>): { button: Child; list: Child; opened: () => boolean } {
  const items = signal<Reviewed[] | null>(null);
  const error = signal("");
  let heading: HTMLElement | null = null;
  const show = () => {
    if (!heading?.isConnected) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start", behavior: calm.peek() ? "auto" : "smooth" });
  };
  const open = async () => {
    if (items.peek()) return show();
    try {
      items.set(await load());
      error.set("");
      requestAnimationFrame(show);
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };
  const button = h("button", { class: "btn", type: "button", onclick: open }, "Прегледай въпросите");
  const list = () => {
    const all = items();
    if (!all) return error() ? h("p", { class: "bad", role: "alert" }, error()) : null;
    heading = h("h2", { class: "review-head", tabindex: -1 }, "Въпросите");
    return h(
      "section",
      { class: "review" },
      heading,
      all.map((it) =>
        h(
          "article",
          { class: "reviewed" },
          h(
            "p",
            { class: "kicker" },
            `${it.n + 1} · ${categories.find((c) => c.id === it.category)?.name ?? ""} · ${formatNumber(it.points)} т.`,
          ),
          h("h3", { class: "ask" }, it.view.text),
          picture(it.view),
          answered(it.view, it.reveal, it.given),
          it.reveal.fact ? fact(it.reveal.fact) : null,
          report(it.reveal.id),
        ),
      ),
    );
  };
  return { button, list, opened: () => items() !== null };
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

const scoreOf = (s: Score) => [h("small", { class: "sub" }, `${s.rights}/10 · `), formatNumber(s.points)];

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
