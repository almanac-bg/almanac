// Теми: questions by topic, as many as you like, shaped by how well you know the topic. Everyone plays the same
// game. The tiles live on Начало; a run of one is /play/<topic>.

import { type Mastery, masteryBadge, masteryLeft } from "../game/mastery.ts";
import { news } from "../game/news.ts";
import { summary } from "../game/results.ts";
import { getReady, playRun } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { type Category, categories, player, user } from "../state.ts";
import { meter, questions, toneOf } from "../ui.ts";
import { loadStats, type Stats } from "./stats.ts";

/** The topics as tiles, each with how well the player knows it, and a run across all of them (on Начало). */
export function topics(): Child {
  const stats = signal<Stats | null>(null);
  if (user.peek()) loadStats().then(stats.set, () => {});
  return h(
    "section",
    { class: "stack" },
    h(
      "div",
      { class: "title-row" },
      h("h2", { class: "section-title" }, "Теми"),
      h("a", { class: "btn inline", href: "/play/all" }, "Всички теми"),
    ),
    h("ul", { class: "topics" }, () => {
      const mine = stats()?.mastery ?? [];
      return categories.map((c) =>
        h(
          "li",
          null,
          tile(
            c,
            mine.find((m) => m.category === c.id),
          ),
        ),
      );
    }),
  );
}

/** A topic: its colour, its name, and how well the player knows it (once they've played enough of it to tell). */
function tile(c: Category, m?: Mastery): Child {
  const sure = m?.sure ? m : null;
  return h(
    "a",
    { href: `/play/${c.id}`, class: `topic ${toneOf(c.id)}` },
    h(
      "span",
      { class: "topic-head" },
      h("span", { class: "dot", "aria-hidden": "true" }),
      sure ? masteryBadge(sure) : null,
    ),
    h("span", { class: "topic-name" }, c.name),
    h(
      "span",
      { class: "topic-foot" },
      h(
        "span",
        { class: "topic-meta" },
        h("span", null, m?.answers ? (sure ? `знаеш ${sure.known}%` : masteryLeft(m)) : "Още не е играна"),
        sure ? h("span", null, questions(sure.answers)) : null,
      ),
      sure ? meter(sure.known, `знаеш ${sure.known}% от темата`) : null,
    ),
  );
}

export function topic([id = ""]: string[]) {
  const category = id === "all" ? "" : id;
  const name = category ? categories.find((c) => c.id === category)?.name : "Всички теми";
  if (name === undefined) {
    go("/", true);
    return null;
  }
  title(name);
  return run(category, name, (s, again) =>
    h(
      "div",
      { class: "screen" },
      h("p", { class: "kicker" }, name),
      summary(
        s,
        null,
        news(s.id),
        h(
          "div",
          { class: "actions" },
          h("button", { class: "btn primary big", onclick: again }, "Още десет"),
          h("a", { class: "btn", href: "/" }, "Друга тема"),
        ),
      ),
    ),
  );
}

/** Plays a run of a topic ("" for all), and what finished draws at its end (again: another run). Each run starts
 * after a short count, which the player can cut short or back out of. */
function run(category: string, name: string, finished: (s: State, again: () => void) => Child): Child {
  const screen = signal<Child>(null);
  const ready = () => screen.set(getReady(name, start, () => go("/")));
  const start = async () => {
    screen.set(h("p", { class: "muted" }, "…"));
    try {
      await player();
      const s = await api<State>("POST", "/api/topic", { category });
      screen.set(playRun(s, (end) => finished(end, ready)));
    } catch (err) {
      screen.set(
        h(
          "div",
          { class: "stack" },
          h("p", { role: "alert" }, (err as ApiError).message),
          h("button", { class: "btn primary", onclick: start }, "Опитай пак"),
        ),
      );
    }
  };
  ready();
  return h("div", null, () => screen());
}
