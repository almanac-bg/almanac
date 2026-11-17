import { h } from "../lib/dom.ts";
import { title } from "../lib/router.ts";

export function missing() {
  title("Няма такава страница");
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("h1", null, "Тази страница я няма"),
      h("p", { class: "lead" }, "Може връзката да е стара или да има грешка в нея."),
    ),
    h("a", { class: "btn primary big", href: "/" }, "Към въпросите на деня"),
  );
}
