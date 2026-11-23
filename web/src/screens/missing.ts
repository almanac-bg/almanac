// A page that isn't there: said plainly, with the way back to Днес — to the day's ten, while they wait.

import { api } from "../lib/api.ts";
import { h, signal } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { user } from "../state.ts";

export function missing() {
  title("Няма такава страница");
  // A player's day may be played already: then it's Днес, not the day's ten, that the way back leads to.
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
      h("h1", null, "Няма такава страница"),
      h("p", { class: "lead" }, "Може би връзката е стара или в нея има грешка."),
    ),
    h("a", { class: "btn primary big", href: "/" }, () => (played() ? "Към Днес" : "Към днешния брой")),
  );
}
