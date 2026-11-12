// АЛМАНАХ's web client: the mark and the name, four links, and the screen the router puts under them.

import { h, mount } from "./lib/dom.ts";
import { reportErrors } from "./lib/errors.ts";
import { path, start } from "./lib/router.ts";
import { challenge } from "./screens/challenge.ts";
import { invite } from "./screens/invite.ts";
import { me } from "./screens/me.ts";
import { missing } from "./screens/missing.ts";
import { challengeNew, topic, topics } from "./screens/play.ts";
import { room } from "./screens/room.ts";
import { today } from "./screens/today.ts";
import { together } from "./screens/together.ts";
import { invitations, watchInvitations } from "./state.ts";

const links: [href: string, label: string, here: (p: string) => boolean][] = [
  ["/", "Днес", (p) => p === "/"],
  ["/play", "Игра", (p) => p.startsWith("/play")],
  [
    "/together",
    "Заедно",
    (p) => p === "/together" || p === "/challenge" || p.startsWith("/r/") || p.startsWith("/c/") || p.startsWith("/f/"),
  ],
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
      h(
        "a",
        { href: "/", class: "name" },
        h("img", { class: "mark", src: "/favicon.svg", alt: "", width: 32, height: 32 }),
        "АЛМАНАХ",
      ),
      h(
        "nav",
        { "aria-label": "Основно" },
        links.map(([href, label, here]) =>
          h(
            "a",
            {
              href,
              "aria-current": () => (here(path()) ? "page" : null),
              // A friend calls to a duel: a dot on Заедно, where the invitation is.
              class: href === "/together" ? () => (invitations().length ? "news" : "") : undefined,
            },
            label,
            href === "/together"
              ? () => (invitations().length ? h("span", { class: "sr" }, " (покана за дуел)") : null)
              : null,
          ),
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
      { path: /^\/challenge$/, view: challengeNew },
      { path: /^\/r\/([0-9]{6})$/, view: room },
      { path: /^\/f\/([a-z0-9]{8})$/, view: invite },
      { path: /^\/me$/, view: me },
    ],
    missing,
  );
  watchInvitations();
}
