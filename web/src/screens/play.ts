// Игра: questions by topic, as many as you like, shaped by how well you know the topic. Everyone plays the same game.

import { type Mastery, masteryBadge, masteryLeft } from "../game/mastery.ts";
import { news } from "../game/news.ts";
import { summary } from "../game/results.ts";
import { playRun } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { type Category, categories, player, user } from "../state.ts";
import { meter, questions, toneOf } from "../ui.ts";
import { modes } from "./modes.ts";
import { loadStats, type Stats } from "./stats.ts";

export function topics() {
  title("Играй");
  const stats = signal<Stats | null>(null);
  if (user.peek()) loadStats().then(stats.set, () => {});
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h(
        "div",
        { class: "title-row" },
        h("h1", null, "Играй"),
        h("a", { class: "btn primary inline", href: "/play/all" }, "Всички теми"),
      ),
      h("p", { class: "lead" }, "Десет въпроса по тема. Колкото повече знаеш, толкова по-трудни стават."),
    ),
    modes(["duel", "royal", "room"], "С други"),
    h("h2", { class: "section-title" }, "Теми"),
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
        m?.answers ? h("span", null, questions(m.answers)) : null,
      ),
      sure ? meter(sure.known, `знаеш ${sure.known}% от темата`) : null,
    ),
  );
}

export function topic([id = ""]: string[]) {
  const category = id === "all" ? "" : id;
  const name = category ? categories.find((c) => c.id === category)?.name : "Всички теми";
  if (name === undefined) {
    go("/play", true);
    return null;
  }
  title(name);
  return run(category, (s, again) =>
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
          h("a", { class: "btn", href: "/play" }, "Друга тема"),
        ),
      ),
    ),
  );
}

/** Plays a run of a topic ("" for all), and what finished draws at its end (again: another run). */
function run(category: string, finished: (s: State, again: () => void) => Child): Child {
  const screen = signal<Child>(h("p", { class: "muted" }, "…"));
  const start = async () => {
    screen.set(h("p", { class: "muted" }, "…"));
    try {
      await player();
      const s = await api<State>("POST", "/api/topic", { category });
      screen.set(playRun(s, (end) => finished(end, start)));
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
  start();
  return h("div", null, () => screen());
}
