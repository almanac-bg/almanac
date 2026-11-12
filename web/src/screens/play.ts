// Игра: questions by topic, as many as you like, shaped by how well you know the topic.

import { shareButton, summary } from "../game/results.ts";
import { playRun } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { categories, player } from "../state.ts";

export function topics() {
  title("Игра");
  return h(
    "section",
    { class: "screen" },
    h("h1", null, "Игра"),
    h("p", null, "Десет въпроса по тема. Колкото повече знаеш, толкова по-трудни стават."),
    h(
      "ul",
      { class: "topics" },
      h("li", null, h("a", { href: "/play/all" }, "Всички теми")),
      categories.map((c) => h("li", null, h("a", { href: `/play/${c.id}` }, c.name))),
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
      h("p", { class: "muted" }, name),
      summary(
        s,
        h(
          "div",
          { class: "actions" },
          h("button", { class: "btn", onclick: again }, "Още десет"),
          challengeButton(s),
          h("a", { href: "/play" }, "Друга тема"),
        ),
      ),
    ),
  );
}

/** Предизвикай: ten questions from every topic, then the link for others to play the same ten. */
export function challengeNew() {
  title("Предизвикай");
  return run("", (s) =>
    h(
      "div",
      { class: "screen" },
      h("p", { class: "muted" }, "Предизвикателство"),
      summary(
        s,
        h(
          "p",
          null,
          "Сега прати линка: приятелите ти играят същите десет въпроса, когато им е удобно, и виждате кой колко има.",
        ),
        challengeButton(s, true),
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
          h("button", { class: "btn", onclick: start }, "Опитай пак"),
        ),
      );
    }
  };
  start();
  return h("div", null, () => screen());
}

/** Makes a challenge link from a finished run (at once, if now), and shares it. */
export function challengeButton(s: State, now = false): Child {
  const link = signal<string | null>(null);
  const error = signal("");
  const make = async () => {
    try {
      link.set((await api<{ url: string }>("POST", `/api/runs/${s.id}/challenge`, {})).url);
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };
  if (now) make();
  return h("div", { class: "stack" }, () => {
    const url = link();
    if (url)
      return [
        shareButton("Изпрати предизвикателството", () => `Аз имам ${s.rights} от ${s.total}. Ти колко ще имаш?`, url),
        h("p", { class: "muted" }, "Линкът: ", h("a", { href: new URL(url).pathname, class: "challenge-link" }, url)),
      ];
    return [
      h("button", { class: "btn", onclick: make }, "Предизвикай някого"),
      error() && h("p", { class: "bad" }, error()),
    ];
  });
}
