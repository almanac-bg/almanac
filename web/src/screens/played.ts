// A game played, gone over on its day: from the day's card on Начало, or today's games in Профил's „Последни игри“,
// how it went and each of its questions with the answer, the fact behind it and how others answered, read-only
// (/games/<id>). A game of a day gone by isn't gone over again (play.Review): the page says so. The way back is to
// Профил.

import type { Reviewed, State } from "../game/types.ts";
import type { Kit } from "../kit.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let { reviewed, scoreCard, api, errorText, h, signal, title, issueWords, topics, back } = {} as Kit;

/** A game as a run of it is: its kind, and the day's day or a topic's topic. */
type Played = Omit<State, "kind"> & { kind: string };

/** What a game was, as its kicker says it. */
function what(s: Played): string {
  switch (s.kind) {
    case "day":
      return s.day ? `Въпросите на деня · ${issueWords(undefined, s.day)}` : "Въпросите на деня";
    case "duel":
      return "Дуел";
    case "royal":
      return "Роял";
    case "room":
      return "Стая";
    default:
      return topics.find((c) => c.id === s.category)?.name ?? "Тема";
  }
}

export function playedGame(kit: Kit, [id = ""]: string[]) {
  ({ reviewed, scoreCard, api, errorText, h, signal, title, issueWords, topics, back } = kit);
  title("Изиграна игра");
  const game = signal<{ s: Played; questions: Reviewed[] } | null>(null);
  const error = signal("");
  Promise.all([
    api<Played>("GET", `/api/runs/${id}`),
    api<{ questions: Reviewed[] }>("GET", `/api/runs/${id}/review`),
  ]).then(
    ([s, r]) => game.set({ s, questions: r.questions }),
    (err) => error.set(errorText(err)),
  );
  return h("section", { class: "screen" }, back("/me", "Профил"), () => {
    const g = game();
    if (!g) return error() ? h("p", { role: "alert" }, error()) : h("p", { class: "muted" }, "…");
    // Laid out as a result is (results.ts), without its ways on: it's over.
    return h(
      "section",
      { class: "summary" },
      scoreCard(g.s as State, h("div", { class: "day-line" }, h("span", { class: "kicker" }, what(g.s)))),
      g.questions.length
        ? reviewed(g.questions, h("h2", { class: "section-title review-head" }, "Въпросите"))
        : h("p", { class: "muted" }, "Въпросите на тази игра вече ги няма."),
    );
  });
}
