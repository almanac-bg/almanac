// Втори шанс: the questions the player got wrong, asked again a few days later, until they get them right; a right
// answer puts its fact in Моят Алманах. The ways in are on Начало (with the topics) and in the Almanac.

import { news } from "../game/news.ts";
import { summary } from "../game/results.ts";
import type { State } from "../game/types.ts";
import { api } from "../lib/api.ts";
import { h, signal } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { loadMistakes, run } from "./play.ts";

export function mistakes() {
  title("Втори шанс");
  return run(
    "Втори шанс",
    () => api<State>("POST", "/api/mistakes"),
    (s, again) => {
      const more = signal(false);
      loadMistakes().then(
        (m) => more.set(m.waiting >= m.from),
        () => {},
      );
      return h(
        "div",
        { class: "screen" },
        h("p", { class: "kicker" }, "Втори шанс"),
        summary(
          s,
          null,
          {
            main: () =>
              more()
                ? h("button", { class: "btn primary big", onclick: again }, "Още въпроси")
                : h("a", { class: "btn primary big", href: "/almanac" }, "Към Алманаха"),
            also: [h("a", { class: "btn", href: "/" }, "Към началото")],
          },
          [news(s.id)],
        ),
      );
    },
  );
}
