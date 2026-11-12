// АЛМАНАХ's web client: a name, three links, and the screen the router puts under them.

import { h, mount } from "./lib/dom.ts";
import { reportErrors } from "./lib/errors.ts";
import { path, start } from "./lib/router.ts";
import { challenge } from "./screens/challenge.ts";
import { me } from "./screens/me.ts";
import { missing } from "./screens/missing.ts";
import { topic, topics } from "./screens/play.ts";
import { room } from "./screens/room.ts";
import { today } from "./screens/today.ts";
import { together } from "./screens/together.ts";

const links: [href: string, label: string, here: (p: string) => boolean][] = [
  ["/", "Днес", (p) => p === "/"],
  ["/play", "Игра", (p) => p.startsWith("/play")],
  ["/together", "Заедно", (p) => p === "/together" || p.startsWith("/r/")],
  ["/me", "Профил", (p) => p === "/me"],
];

reportErrors();

const root = document.getElementById("app");
if (root) {
  const main = h("main", { id: "main" });
  mount(root, () => [
    h(
      "header",
      { class: "top" },
      h("a", { href: "/", class: "name" }, "АЛМАНАХ"),
      h(
        "nav",
        { "aria-label": "Основно" },
        links.map(([href, label, here]) =>
          h("a", { href, "aria-current": () => (here(path()) ? "page" : null) }, label),
        ),
      ),
    ),
    main,
  ]);
  start(
    main,
    [
      { path: /^\/$/, view: today },
      { path: /^\/play$/, view: topics },
      { path: /^\/play\/([a-z]+)$/, view: topic },
      { path: /^\/c\/([a-z0-9]{6})$/, view: challenge },
      { path: /^\/together$/, view: together },
      { path: /^\/r\/([0-9]{6})$/, view: room },
      { path: /^\/me$/, view: me },
    ],
    missing,
  );
}
