import { h } from "../lib/dom.ts";
import { title } from "../lib/router.ts";

export function today() {
  title();
  const date = new Intl.DateTimeFormat("bg", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  return h(
    "section",
    { class: "screen" },
    h("p", { class: "eyebrow" }, date),
    h("h1", null, "Десет въпроса за днес"),
    h("p", { class: "muted" }, "По един от всяка тема, от лесен към труден. Един опит, едни и същи въпроси за всички."),
  );
}
