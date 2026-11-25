// АЛМАНАХ's web client: its frame — the bar (the rosette and the name, the three places on a big screen, the
// player's avatar in the corner: Профил and Настройки), the double rule under it, the three places as words at the
// foot of a phone's screen — and the screen the router puts under it. A game has the whole screen: the frame steps
// aside while one is under way. A new visitor's cover (the day alone: screens/today.ts) and the sign-in page
// (`/signin`) have the frame bare: the mark where it always is, no places (and on the sign-in page no „Вход“).

import { keepFresh } from "./fresh.ts";
import { computed, effect, h, mount } from "./lib/dom.ts";
import { reportErrors } from "./lib/errors.ts";
import { applyPrefs } from "./lib/prefs.ts";
import { preparePush } from "./lib/push.ts";
import { path, start } from "./lib/router.ts";
import { prepareSound } from "./lib/sound.ts";
import { almanac, chapter as bookChapter } from "./screens/almanac.ts";
import { duelOne } from "./screens/duel.ts";
import { friends } from "./screens/friends.ts";
import { me } from "./screens/me.ts";
import { missing } from "./screens/missing.ts";
import { chapter } from "./screens/play.ts";
import { playerProfile } from "./screens/player.ts";
import { settings } from "./screens/settings.ts";
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

const root = document.getElementById("app");
if (root) draw(root);

/** The frame and the screen under it, started. */
function draw(root: HTMLElement): void {
  const main = h("main", { id: "main" });
  // The bar's corner: the player's avatar, Профил (and Настройки in it; not on Профил itself, whose page has it).
  // Without a profile yet (or on the cover, not signed in), the way in; on the way in itself, nothing. Drawn again only
  // when which of these it is changes, or the face: a link drawn anew on every change to the player went from under a
  // press when a name, saved as the press left Настройки, came back before the release, and the click went nowhere.
  const corner = computed(() => {
    if (path() === "/signin") return null;
    const u = user();
    if (!u || (cover() && !u.email)) return "in";
    return path() === "/me" ? null : "me";
  });
  const face = computed(look);
  mount(root, () => [
    h(
      "header",
      { class: "frame" },
      h(
        "div",
        { class: "bar" },
        h("a", { href: "/", class: "brand", "aria-label": "АЛМАНАХ, днешният брой" }, rosette(), "АЛМАНАХ"),
        h("nav", { class: "places", "aria-label": "Основна навигация" }, placeLinks()),
        () => {
          const c = corner();
          if (c === "in") return h("a", { class: "bar-in", href: "/signin" }, "Вход");
          if (c === "me") return h("a", { class: "bar-me", href: "/me", "aria-label": "Профил" }, () => avatar(face()));
          return null;
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
      { path: /^\/almanac$/, view: almanac },
      { path: /^\/almanac\/([a-z]+)$/, view: bookChapter },
      { path: /^\/friends$/, view: friends },
      { path: /^\/settings$/, view: settings },
      { path: /^\/d\/([0-9]{1,5})-([a-z2-9]{8})$/, view: sharedDay },
      { path: /^\/me$/, view: me },
      { path: /^\/signin$/, view: signInPage },
      { path: /^\/players\/([A-Za-z0-9_.]{3,20})$/, view: playerProfile },
    ],
    missing,
  );
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
