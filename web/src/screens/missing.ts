import { h } from "../lib/dom.ts";
import { title } from "../lib/router.ts";

export function missing() {
  title("Няма я");
  return h(
    "section",
    { class: "screen" },
    h("h1", null, "Тази страница я няма"),
    h("p", { class: "lead" }, "Може линкът да е стар или да има грешка в него."),
    h("a", { class: "btn primary", href: "/" }, "Към днешните въпроси"),
  );
}
