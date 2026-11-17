// Втори шанс: the questions the player got wrong, asked again a few days later, until they get them right; a right
// answer puts its fact in Моят Алманах. The ways in are on Начало (with the topics) and in the Almanac. Come to with
// too few waiting (and none left half-way), it says so at once, before any count.

import { news } from "../game/news.ts";
import { summary } from "../game/results.ts";
import type { State } from "../game/types.ts";
import { api } from "../lib/api.ts";
import { h, signal } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { user } from "../state.ts";
import { loadMistakes, run } from "./play.ts";

export function mistakes() {
  title("Втори шанс");
  return run({
    name: "Втори шанс",
    lead: "Въпросите, на които сгреши, още веднъж.",
    begin: () => api<State>("POST", "/api/mistakes"),
    left: (l) => l.kind === "mistakes",
    closed: async () => {
      const m = user.peek() ? await loadMistakes().catch(() => null) : { waiting: 0, from: 1 };
      if (!m || m.waiting >= m.from) return null; // can't tell: the game itself says
      return h(
        "section",
        { class: "screen stack" },
        h(
          "div",
          { class: "intro" },
          h("h1", null, "Втори шанс"),
          h(
            "p",
            { class: "lead" },
            "Още няма въпроси за втори шанс. Тук идват въпросите, на които не позна, няколко дни по-късно.",
          ),
        ),
        h("a", { class: "btn primary big", href: "/" }, "Към Начало"),
      );
    },
    finished: (s, again, just) => {
      const more = signal(false);
      loadMistakes().then(
        (m) => more.set(m.waiting >= m.from),
        () => {},
      );
      return h(
        "div",
        { class: "screen" },
        // What was played, where the day's result has its date: every result laid out the same.
        summary(
          s,
          h("div", { class: "day-line" }, h("span", { class: "kicker" }, "Втори шанс")),
          {
            main: () =>
              more()
                ? h("button", { class: "btn primary big", onclick: again }, "Още въпроси")
                : h("a", { class: "btn primary big", href: "/almanac" }, "Към Алманаха"),
            also: [h("a", { class: "btn", href: "/" }, "Към Начало")],
          },
          just ? [news(s.id)] : [],
          undefined,
          just,
        ),
      );
    },
  });
}
