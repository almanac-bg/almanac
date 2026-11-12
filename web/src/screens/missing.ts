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

/** A challenge link from before: challenges are gone, and friends play each other now. */
export function challengeGone() {
  title("Стар линк");
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Стар линк"),
      h("h1", null, "Предизвикателствата ги няма"),
      h(
        "p",
        { class: "lead" },
        "Сега се играе с приятели: добави ги и се канете на дуел, на живо. А днешните въпроси сравнявате всеки ден.",
      ),
    ),
    h("a", { class: "btn primary", href: "/together" }, "Към Заедно"),
  );
}
