// АЛМАНАХ's web client: the edition's frame — the bar (the rosette and the name, the three places on a big screen, the
// player's avatar in the corner: Профил and Настройки), the double rule under it, the three places as words at the
// foot of a phone's screen — and the screen the router puts under it. A game has the whole screen: the frame steps
// aside while one is under way, and on a new visitor's cover (the day alone: screens/today.ts).

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
import { forgetOnSignOut, invited, invitePath } from "./screens/invite.ts";
import { missing } from "./screens/missing.ts";
import { topic } from "./screens/play.ts";
import { sharedDay, today } from "./screens/today.ts";
import { cover, friendsNews, look, playing, user, watchNews, wornSeal } from "./state.ts";
import { avatar, rosette, worn } from "./ui.ts";

/** The three places (DECISIONS.md, „The redesign“): where each goes, its name, and which paths are part of it. A game
 * of the day is played on Днес, a topic's from its chapter in the Алманах; a duel is the friends'. */
const places: [href: string, label: string, here: (p: string) => boolean][] = [
  ["/", "Днес", (p) => p === "/" || invitePath.test(p)],
  ["/almanac", "Алманах", (p) => /^\/(almanac|play)(\/|$)/.test(p)],
  ["/friends", "Приятели", (p) => /^\/(friends|duel|players)(\/|$)/.test(p)],
];

reportErrors();
applyPrefs();
keepFresh();
loadPictures().catch(() => {}); // the illustrations, in a file of their own: on their way at once

/** The places as links (the bar's on a big screen, the foot's on a phone): the one here marked; a dot on Приятели
 * while something has come there since the player last looked (friendsNews). */
const placeLinks = () =>
  places.map(([href, label, here]) =>
    h(
      "a",
      {
        href,
        "aria-current": () => (here(path()) ? "page" : null),
        // News in Приятели since the player last looked: a dot on it.
        class: () => (href === "/friends" && friendsNews() ? "news" : ""),
      },
      label,
      () => (href === "/friends" && friendsNews() ? h("span", { class: "sr" }, " (има ново)") : null),
    ),
  );

const root = document.getElementById("app");
if (root) {
  const main = h("main", { id: "main" });
  mount(root, () => [
    h(
      "header",
      { class: "frame" },
      h(
        "div",
        { class: "bar" },
        h("a", { href: "/", class: "brand", "aria-label": "АЛМАНАХ, днешният брой" }, rosette(), "АЛМАНАХ"),
        h("nav", { class: "places", "aria-label": "Основна навигация" }, placeLinks()),
        // The player's avatar with the seal they wear: Профил, and Настройки in it (not on Профил itself, whose page
        // has it). Without a profile yet (or on the cover, not signed in), the way in.
        () => {
          const u = user();
          if (!u || (cover() && !u.email)) return h("a", { class: "bar-in", href: "/me#signin" }, "Вход");
          if (path() === "/me") return null;
          return h(
            "a",
            { class: "bar-me", href: "/me", "aria-label": "Профил" },
            () => avatar(look()),
            () => worn(wornSeal(), 24),
          );
        },
      ),
    ),
    main,
    h("nav", { class: "places-foot", "aria-label": "Основна навигация" }, placeLinks()),
  ]);
  start(
    main,
    [
      { path: /^\/$/, view: today },
      { path: /^\/play\/([a-z]+)$/, view: topic },
      { path: /^\/duel\/new$/, view: duelNew },
      { path: /^\/duel\/([0-9]+)$/, view: duelOne },
      { path: /^\/almanac$/, view: later(() => import("./screens/almanac.ts").then((m) => m.almanac)) },
      { path: /^\/almanac\/([a-z]+)$/, view: later(() => import("./screens/almanac.ts").then((m) => m.chapter)) },
      { path: /^\/friends$/, view: later(() => import("./screens/friends.ts").then((m) => m.friends)) },
      { path: /^\/settings$/, view: later(() => import("./screens/settings.ts").then((m) => m.settings)) },
      { path: /^\/d\/([0-9]{1,5})-([a-z2-9]{8})$/, view: sharedDay },
      { path: /^\/f\/([a-z2-9]{10})$/, view: (m) => invited(m, today) },
      { path: /^\/me$/, view: later(() => import("./screens/me.ts").then((m) => m.me)) },
      {
        path: /^\/players\/([A-Za-z0-9_]{3,20})$/,
        view: later(() => import("./screens/player.ts").then((m) => m.playerProfile)),
      },
    ],
    missing,
  );
  // In a game the frame steps aside (app.css): the question gets the screen. On a new visitor's cover, the places too.
  effect(() => document.documentElement.classList.toggle("playing", playing()));
  // Днес is the cover at its own address and at an invite's, until the invite is answered (screens/invite.ts).
  effect(() =>
    document.documentElement.classList.toggle("cover", cover() && (path() === "/" || invitePath.test(path()))),
  );
  watchNews();
  forgetOnSignOut();
  prepareSound();
  preparePush();
}
