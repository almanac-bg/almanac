import { h } from "../lib/dom.ts";
import { title } from "../lib/router.ts";

export function missing() {
  title("Няма я");
  return h(
    "section",
    { class: "screen" },
    h("h1", null, "Тази страница я няма"),
    h("p", { class: "lead" }, "Може връзката да е стара или да има грешка в нея."),
    h("a", { class: "btn primary", href: "/" }, "Към днешните въпроси"),
  );
}

/** A challenge link from before: challenges are gone, and friends play each other now. */
export function challengeGone() {
  title("Стара връзка");
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Стара връзка"),
      h("h1", null, "Предизвикателствата ги няма"),
      h(
        "p",
        { class: "lead" },
        "Сега се играе с приятели: добави ги и се канете на дуел. А резултатите от въпросите на деня сравнявате всеки ден.",
      ),
    ),
    h("a", { class: "btn primary", href: "/duel" }, "Към дуелите"),
  );
}
