// Игра: questions by topic, as many as you like, shaped by how well you know the topic, or as the player sets them:
// how many, how hard, which kinds, and how much time.

import { news } from "../game/news.ts";
import { summary } from "../game/results.ts";
import { playRun } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import {
  difficulties,
  difficultyWords,
  forServer,
  isStandard,
  kinds,
  kindWords,
  lengths,
  lengthWords,
  quiz,
  setQuiz,
  standard,
  summaryOf,
  toggleKind,
} from "../lib/quiz.ts";
import { go, title } from "../lib/router.ts";
import { type Category, categories, player, user } from "../state.ts";
import { level, levelBadge, meter, questions, toneOf } from "../ui.ts";
import { modes } from "./modes.ts";
import { loadStats, type Stats, type TopicStats } from "./stats.ts";

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
      h(
        "p",
        { class: "lead" },
        "Въпроси по тема — по подразбиране десет, които стават по-трудни, колкото повече знаеш. Или ги настрой.",
      ),
    ),
    modes(["duel", "royal", "room"], "С други"),
    settings(),
    h("h2", { class: "section-title" }, "Теми"),
    h("ul", { class: "topics" }, () => {
      const mine = stats()?.topics ?? [];
      return categories.map((c) =>
        h(
          "li",
          null,
          tile(
            c,
            mine.find((t) => t.category === c.id),
          ),
        ),
      );
    }),
  );
}

/** A group of chips to pick from; pressed: whether a chip is on. */
function group<T>(
  legend: string,
  values: readonly T[],
  label: (v: T) => string,
  pressed: (v: T) => boolean,
  pick: (v: T) => void,
) {
  return h(
    "fieldset",
    { class: "quiz-group" },
    h("legend", null, legend),
    h(
      "ul",
      { class: "chips" },
      values.map((v) =>
        h(
          "li",
          null,
          h(
            "button",
            { class: "chip", type: "button", "aria-pressed": () => pressed(v), onclick: () => pick(v) },
            label(v),
          ),
        ),
      ),
    ),
  );
}

/** The game's settings: what a topic run will be, in a line, and the choices behind a button. */
function settings(): Child {
  const open = signal(false);
  return h(
    "section",
    { class: "card quiz-settings", "aria-labelledby": "quiz-title" },
    h(
      "div",
      { class: "card-head" },
      h(
        "div",
        null,
        h("h2", { class: "quiz-title", id: "quiz-title" }, "Настройки на играта"),
        h("p", { class: "muted quiz-summary" }, () => summaryOf(quiz())),
      ),
      h(
        "button",
        {
          class: "btn inline",
          type: "button",
          "aria-expanded": () => open(),
          "aria-controls": "quiz-panel",
          onclick: () => open.set(!open.peek()),
        },
        () => (open() ? "Готово" : "Промени"),
      ),
    ),
    h(
      "div",
      { class: "quiz-panel", id: "quiz-panel", hidden: () => !open() },
      group(
        "Въпроси",
        lengths,
        (n) => String(n),
        (n) => quiz().length === n,
        (n) => setQuiz({ length: n }),
      ),
      group(
        "Трудност",
        difficulties,
        (d) => difficultyWords[d],
        (d) => quiz().difficulty === d,
        (d) => setQuiz({ difficulty: d }),
      ),
      group(
        "Видове",
        ["all", ...kinds] as const,
        (k) => (k === "all" ? "Всички" : kindWords[k]),
        (k) => (k === "all" ? !quiz().kinds.length : quiz().kinds.includes(k)),
        (k) => (k === "all" ? setQuiz({ kinds: [] }) : toggleKind(k)),
      ),
      group(
        "Време",
        [false, true],
        (slow) => (slow ? "Двойно" : "Обичайно"),
        (slow) => quiz().slow === slow,
        (slow) => setQuiz({ slow }),
      ),
      () =>
        isStandard(quiz())
          ? null
          : h("button", { class: "link", type: "button", onclick: () => setQuiz(standard) }, "Както по подразбиране"),
    ),
  );
}

/** A topic: its colour, its name, and how well the player knows it (once they've played enough of it). */
function tile(c: Category, t?: TopicStats): Child {
  const l = t ? level(t.right, t.answers) : null;
  return h(
    "a",
    { href: `/play/${c.id}`, class: `topic ${toneOf(c.id)}` },
    h("span", { class: "topic-head" }, h("span", { class: "dot", "aria-hidden": "true" }), l ? levelBadge(l) : null),
    h("span", { class: "topic-name" }, c.name),
    h(
      "span",
      { class: "topic-foot" },
      h(
        "span",
        { class: "topic-meta" },
        h("span", null, t?.answers ? questions(t.answers) : "Още не е играна"),
        l ? h("span", null, `${l.percent}% верни`) : null,
      ),
      l ? meter(l.percent, `${l.percent}% верни`) : null,
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
        news(),
        h(
          "div",
          { class: "actions" },
          h(
            "button",
            { class: "btn primary big", onclick: again },
            `Още ${lengthWords[s.total as 5 | 10 | 15] ?? s.total}`,
          ),
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
      const s = await api<State>("POST", "/api/topic", { category, settings: forServer(quiz.peek()) });
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
