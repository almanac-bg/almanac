// АЛМАНАХ's web client: the mark and the name, the four main places (in the header on a big screen, a bar at the
// bottom of a phone's), and the screen the router puts under them.

import { loadPictures } from "./art/picture.ts";
import { keepFresh } from "./fresh.ts";
import { later } from "./kit.ts";
import { effect, h, mount } from "./lib/dom.ts";
import { reportErrors } from "./lib/errors.ts";
import { applyPrefs } from "./lib/prefs.ts";
import { preparePush } from "./lib/push.ts";
import { path, start } from "./lib/router.ts";
import { prepareSound } from "./lib/sound.ts";
import { duelNew, duelOne } from "./screens/duel.ts";
import { handoff } from "./screens/keep.ts";
import { missing } from "./screens/missing.ts";
import { topic } from "./screens/play.ts";
import { sharedDay, today } from "./screens/today.ts";
import { duelsWaiting, friendRequests, playing, watchWaiting } from "./state.ts";

/**
 * The four main places: where each goes, its name and icon, and which paths are part of it. The day and the topics
 * are played from Начало, duels from Приятели; Профил holds what a player has: their almanac, their avatar and their
 * settings.
 */
const links: [href: string, label: string, icon: string, here: (p: string) => boolean][] = [
  ["/", "Начало", "home", (p) => /^\/($|play\/)/.test(p)],
  ["/friends", "Приятели", "users", (p) => /^\/(friends|duel\/.+)$/.test(p)],
  ["/ranks", "Класации", "podium", (p) => p === "/ranks"],
  ["/me", "Профил", "user", (p) => /^\/(me|settings|avatar|almanac|games(\/[0-9]+)?)$/.test(p)],
];

reportErrors();
applyPrefs();
keepFresh();
loadPictures().catch(() => {}); // the illustrations, in a file of their own: on their way at once

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
        { class: "tabs", "aria-label": "Основно" },
        links.map(([href, label, icon, here]) =>
          h(
            "a",
            {
              href,
              "aria-current": () => (here(path()) ? "page" : null),
              // Someone asks to be friends, or a friend's duel waits: a dot on Приятели.
              class: () => (href === "/friends" && (friendRequests() || duelsWaiting()) ? "news" : ""),
            },
            h("span", { class: `i i-${icon}`, "aria-hidden": "true" }),
            h("span", { class: "tab-label" }, label),
            () =>
              href !== "/friends"
                ? null
                : friendRequests()
                  ? h("span", { class: "sr" }, " (покана за приятелство)")
                  : duelsWaiting()
                    ? h("span", { class: "sr" }, " (дуел те чака)")
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
      { path: /^\/play\/([a-z]+)$/, view: topic },
      { path: /^\/duel\/new$/, view: duelNew },
      { path: /^\/duel\/([0-9]+)$/, view: duelOne },
      { path: /^\/almanac$/, view: later(() => import("./screens/almanac.ts").then((m) => m.almanac)) },
      { path: /^\/ranks$/, view: later(() => import("./screens/ranks.ts").then((m) => m.ranks)) },
      { path: /^\/avatar$/, view: later(() => import("./screens/avatar.ts").then((m) => m.avatarChoice)) },
      { path: /^\/friends$/, view: later(() => import("./screens/friends.ts").then((m) => m.friends)) },
      { path: /^\/settings$/, view: later(() => import("./screens/settings.ts").then((m) => m.settings)) },
      { path: /^\/hand\/([A-Za-z0-9_-]{43})$/, view: handoff },
      { path: /^\/d\/([0-9]{1,5})-([a-z2-9]{8})$/, view: sharedDay },
      { path: /^\/me$/, view: later(() => import("./screens/me.ts").then((m) => m.me)) },
      { path: /^\/games$/, view: later(() => import("./screens/games.ts").then((m) => m.games)) },
      { path: /^\/games\/([0-9]+)$/, view: later(() => import("./screens/played.ts").then((m) => m.playedGame)) },
      {
        path: /^\/players\/([A-Za-z0-9_]{3,20})$/,
        view: later(() => import("./screens/player.ts").then((m) => m.playerProfile)),
      },
    ],
    missing,
  );
  // In a game, a phone's bar of places steps aside (app.css): the question gets the screen.
  effect(() => document.documentElement.classList.toggle("playing", playing()));
  watchWaiting();
  prepareSound();
  preparePush();
}
