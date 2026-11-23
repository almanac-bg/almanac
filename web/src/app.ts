// АЛМАНАХ's web client: its frame — the bar (the rosette and the name, the three places on a big screen, the
// player's avatar in the corner: Профил and Настройки), the double rule under it, the three places as words at the
// foot of a phone's screen — and the screen the router puts under it. A game has the whole screen: the frame steps
// aside while one is under way. A new visitor's cover (the day alone: screens/today.ts) and the sign-in page
// (`/signin`) have the frame bare: the mark where it always is, no places (and on the sign-in page no „Вход“).

import { loadPictures } from "./art/picture.ts";
import { keepFresh } from "./fresh.ts";
import { later } from "./kit.ts";
import { effect, h, mount } from "./lib/dom.ts";
import { reportErrors } from "./lib/errors.ts";
import { applyPrefs } from "./lib/prefs.ts";
import { preparePush } from "./lib/push.ts";
import { path, start } from "./lib/router.ts";
import { prepareSound } from "./lib/sound.ts";
import { duelOne } from "./screens/duel.ts";
import { missing } from "./screens/missing.ts";
import { chapter } from "./screens/play.ts";
import { signInPage } from "./screens/signin.ts";
import { sharedDay, today } from "./screens/today.ts";
import { cover, friendsNews, look, playing, user, watchNews } from "./state.ts";
import { avatar, rosette } from "./ui.ts";

/** The three places (DECISIONS.md, „The direction“): where each goes, its name, and which paths are part of it. A game
 * of the day is played on Днес, and its board is on its result; a chapter's from its chapter in the Алманах; a duel
 * is the friends'. */
const places: [href: string, label: string, icon: string, here: (p: string) => boolean][] = [
  ["/", "Днес", "today", (p) => p === "/"],
  ["/almanac", "Алманах", "book", (p) => /^\/(almanac|play)(\/|$)/.test(p)],
  ["/friends", "Приятели", "friends", (p) => /^\/(friends|duel|players)(\/|$)/.test(p)],
];

reportErrors();
applyPrefs();
keepFresh();
// The illustrations, in a file of their own: asked for with the page (server/pages.go, a modulepreload) and on their way
// at once.
const pictures = loadPictures().catch(() => {});

/** The places as links (the bar's on a big screen, the foot's on a phone): the one here marked; a dot on Приятели
 * while something has come there since the player last looked (friendsNews). */
const placeLinks = () =>
  places.map(([href, label, icon, here]) =>
    h(
      "a",
      {
        href,
        "aria-current": () => (here(path()) ? "page" : null),
        // News in Приятели since the player last looked: a dot on it.
        class: () => (href === "/friends" && friendsNews() ? "news" : ""),
      },
      h("span", { class: `i i-${icon}`, "aria-hidden": "true" }),
      label,
      () => (href === "/friends" && friendsNews() ? h("span", { class: "sr" }, " (има ново)") : null),
    ),
  );

// The first screen drawn with its pictures (the cover's ten glyphs, the avatar): their file is a sixth of the app's and
// asked for beside it, so it's nearly always in first, but its module comes a moment after the app's, and a cold
// load painted the cover's glyphs as empty tiles that popped in. Never held for them more than a moment.
const root = document.getElementById("app");
if (root) Promise.race([pictures, new Promise((r) => setTimeout(r, 500))]).then(() => draw(root));

/** The frame and the screen under it, started. */
function draw(root: HTMLElement): void {
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
        // The player's avatar: Профил, and Настройки in it (not on Профил itself, whose page
        // has it). Without a profile yet (or on the cover, not signed in), the way in; on the way in itself, nothing.
        () => {
          if (path() === "/signin") return null;
          const u = user();
          if (!u || (cover() && !u.email)) return h("a", { class: "bar-in", href: "/signin" }, "Вход");
          if (path() === "/me") return null;
          return h("a", { class: "bar-me", href: "/me", "aria-label": "Профил" }, () => avatar(look()));
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
      { path: /^\/play\/([a-z]+)$/, view: chapter },
      { path: /^\/duel\/([0-9]+)$/, view: duelOne },
      { path: /^\/almanac$/, view: later(() => import("./screens/almanac.ts").then((m) => m.almanac)) },
      { path: /^\/almanac\/([a-z]+)$/, view: later(() => import("./screens/almanac.ts").then((m) => m.chapter)) },
      { path: /^\/friends$/, view: later(() => import("./screens/friends.ts").then((m) => m.friends)) },
      { path: /^\/settings$/, view: later(() => import("./screens/settings.ts").then((m) => m.settings)) },
      { path: /^\/d\/([0-9]{1,5})-([a-z2-9]{8})$/, view: sharedDay },
      { path: /^\/me$/, view: later(() => import("./screens/me.ts").then((m) => m.me)) },
      { path: /^\/signin$/, view: signInPage },
      {
        path: /^\/players\/([A-Za-z0-9_.]{3,20})$/,
        view: later(() => import("./screens/player.ts").then((m) => m.playerProfile)),
      },
    ],
    missing,
  );
  // The places' own code, once the first screen is in and the browser has a moment: a place opened later is drawn at
  // once, its file already here (later's load comes from memory), never a blank page while it comes.
  const places = () => {
    for (const load of [
      () => import("./screens/almanac.ts"),
      () => import("./screens/friends.ts"),
      () => import("./screens/me.ts"),
    ])
      load().catch(() => {});
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(places, { timeout: 5000 });
  else setTimeout(places, 2000);
  // In a game the frame steps aside (app.css): the question gets the screen.
  effect(() => document.documentElement.classList.toggle("playing", playing()));
  // The frame bare, no places: a new visitor's cover (Днес at its own address), and the sign-in page.
  // Днес without a player is the cover from the first frame: not once the day has loaded (cover), or the places would
  // flash in and out on the way back from the sign-in page.
  effect(() => document.documentElement.classList.toggle("bare", (!user() && path() === "/") || path() === "/signin"));
  watchNews();
  prepareSound();
  preparePush();
}
