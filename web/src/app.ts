// АЛМАНАХ's web client: the mark and the name, the five main places (in the header on a big screen, a bar at the
// bottom of a phone's), and the screen the router puts under them.

import { h, mount } from "./lib/dom.ts";
import { reportErrors } from "./lib/errors.ts";
import { applyPrefs } from "./lib/prefs.ts";
import { path, start } from "./lib/router.ts";
import { prepareSound } from "./lib/sound.ts";
import { almanac } from "./screens/almanac.ts";
import { duel, duelOne } from "./screens/duel.ts";
import { friends } from "./screens/friends.ts";
import { invite } from "./screens/invite.ts";
import { me } from "./screens/me.ts";
import { challengeGone, missing } from "./screens/missing.ts";
import { topic, topics } from "./screens/play.ts";
import { ranks } from "./screens/ranks.ts";
import { rewards } from "./screens/rewards.ts";
import { room } from "./screens/room.ts";
import { royal } from "./screens/royal.ts";
import { settings } from "./screens/settings.ts";
import { today } from "./screens/today.ts";
import { together } from "./screens/together.ts";
import { duelTurns, friendRequests, invitations, watchInvitations } from "./state.ts";

/** The five main places: where each goes, its name and icon, and which paths are part of it. */
const links: [href: string, label: string, icon: string, here: (p: string) => boolean][] = [
  ["/", "Начало", "home", (p) => p === "/"],
  ["/play", "Играй", "play", (p) => /^\/(play|duel|royal|room|r\/)/.test(p)],
  ["/ranks", "Класации", "podium", (p) => p === "/ranks"],
  ["/rewards", "Награди", "award", (p) => p === "/rewards"],
  ["/me", "Профил", "user", (p) => /^\/(me|friends|settings|almanac|f\/)/.test(p) || p === "/together"],
];

reportErrors();
applyPrefs();

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
              // A friend calls to a duel: a dot on Играй; someone asks to be friends: a dot on Профил.
              class: () =>
                (href === "/play" && (invitations().length || duelTurns())) || (href === "/me" && friendRequests())
                  ? "news"
                  : "",
            },
            h("span", { class: `i i-${icon}`, "aria-hidden": "true" }),
            h("span", { class: "tab-label" }, label),
            () =>
              href === "/play" && (invitations().length || duelTurns())
                ? h("span", { class: "sr" }, " (дуел те чака)")
                : href === "/me" && friendRequests()
                  ? h("span", { class: "sr" }, " (покана за приятелство)")
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
      { path: /^\/c\/([a-z0-9]{6})$/, view: challengeGone },
      { path: /^\/duel$/, view: duel },
      { path: /^\/duel\/([0-9]+)$/, view: duelOne },
      { path: /^\/royal$/, view: royal },
      { path: /^\/almanac$/, view: almanac },
      { path: /^\/room$/, view: () => together("room") },
      { path: /^\/ranks$/, view: ranks },
      { path: /^\/rewards$/, view: rewards },
      { path: /^\/friends$/, view: friends },
      { path: /^\/settings$/, view: settings },
      // Where friends were before: a link in an old notification still lands somewhere that makes sense.
      { path: /^\/together$/, view: friends },
      { path: /^\/r\/([0-9]{6})$/, view: room },
      { path: /^\/f\/([a-z0-9]{8})$/, view: invite },
      { path: /^\/me$/, view: me },
    ],
    missing,
  );
  watchInvitations();
  prepareSound();
}
