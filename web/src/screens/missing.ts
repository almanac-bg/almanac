// A page that isn't there: said plainly, with the way back to Начало — to the day's ten, while they wait.

import { api } from "../lib/api.ts";
import { h, signal } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { user } from "../state.ts";

export function missing() {
  title("Няма такава страница");
  // A player's day may be played already: then it's Начало, not the day's ten, that the way back leads to.
  const played = signal(false);
  if (user.peek())
    api<{ run: { done: boolean } | null }>("GET", "/api/day").then(
      (t) => played.set(!!t.run?.done),
      () => {},
    );
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("h1", null, "Тази страница я няма"),
      h("p", { class: "lead" }, "Може връзката да е стара или да има грешка в нея."),
    ),
    h("a", { class: "btn primary big", href: "/" }, () => (played() ? "Към Днес" : "Към въпросите на деня")),
  );
}
