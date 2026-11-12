import { h } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { categories } from "../state.ts";

export function play() {
  title("Игра");
  return h(
    "section",
    { class: "screen" },
    h("h1", null, "Игра"),
    h(
      "p",
      { class: "muted" },
      "Избери тема. Въпросите следват колко знаеш: колкото по-добре се справяш, толкова по-трудни стават.",
    ),
    h(
      "ul",
      { class: "topics" },
      categories.map((c) =>
        h(
          "li",
          null,
          h(
            "span",
            { class: "topic", style: { "--topic": c.color } },
            h("span", { "aria-hidden": "true" }, c.icon),
            c.name,
          ),
        ),
      ),
    ),
  );
}
