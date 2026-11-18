// АЛМАНАХ's web client: the mark and the name, the four main places (in the header on a big screen, a bar at the
// bottom of a phone's), and the screen the router puts under them.

import { loadPictures } from "./art/picture.ts";
import { keepFresh, resumed } from "./fresh.ts";
import { later } from "./kit.ts";
import { api, asking, errorText, forget } from "./lib/api.ts";
import { startApp } from "./lib/app.ts";
import { type Child, effect, h, mount, signal } from "./lib/dom.ts";
import { reportErrors } from "./lib/errors.ts";
import { applyPrefs } from "./lib/prefs.ts";
import { preparePush } from "./lib/push.ts";
import { canGoBack, coming, entry, go, navigate, path, prefetch, start, waitFor } from "./lib/router.ts";
import { prepareSound } from "./lib/sound.ts";
import { challenge, challengeFriend, newChallenge } from "./screens/challenge.ts";
import { duel, duelOne, playChallenge } from "./screens/duel.ts";
import { invite } from "./screens/invite.ts";
import { handoff } from "./screens/keep.ts";
import { missing } from "./screens/missing.ts";
import { mistakes } from "./screens/mistakes.ts";
import { topic } from "./screens/play.ts";
import { rooms } from "./screens/rooms.ts";
import { today } from "./screens/today.ts";
import { type Challenge, challenges, checkWaiting, friendRequests, playing, user, watchWaiting } from "./state.ts";
import { until } from "./ui.ts";

/**
 * The four main places: where each goes, its name and icon, and which paths are part of it. Playing (every way) starts
 * from Начало; Профил holds what a player has: their rewards, their wardrobe, their almanac and their settings.
 */
const links: [href: string, label: string, icon: string, here: (p: string) => boolean][] = [
  // An invite (/f/) brings its taker to the day's ten: Начало's.
  ["/", "Начало", "home", (p) => /^\/($|play\/|mistakes|duel|royal|room|r\/|f\/)/.test(p)],
  ["/friends", "Приятели", "users", (p) => p === "/friends"],
  ["/ranks", "Класации", "podium", (p) => p === "/ranks"],
  [
    "/me",
    "Профил",
    "user",
    (p) => /^\/(me|settings|rewards|wardrobe|almanac|year\/[0-9]{4}|games(\/[0-9]+)?)$/.test(p),
  ],
];

reportErrors();
applyPrefs();
keepFresh();
startApp({
  navigate,
  go,
  // Android's back puts the app away from Начало, unless a game is under way there (the day's ten), which it asks of.
  home: () => location.pathname === "/" && !entry().game && !playing.peek(),
  playing: () => playing.peek(),
  canGoBack,
  resumed,
});
loadPictures().catch(() => {}); // the illustrations, in a file of their own: on their way at once
// A screen opening waits for what it asks the server for (router.ts). What was kept of the server's answers (lib/api.ts,
// last) is no one's once the player is someone else, or no one.
asking.push(waitFor);
let who = user.peek()?.id;
effect(() => {
  const id = user()?.id;
  if (id !== who) forget();
  who = id;
});

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
              // A duel waits for the player: a dot on Начало; someone asks to be friends: a dot on Приятели.
              class: () =>
                (href === "/" && challenges().length) || (href === "/friends" && friendRequests()) ? "news" : "",
            },
            h("span", { class: `i i-${icon}`, "aria-hidden": "true" }),
            h("span", { class: "tab-label" }, label),
            () =>
              href === "/" && challenges().length
                ? h("span", { class: "sr" }, " (дуел те чака)")
                : href === "/friends" && friendRequests()
                  ? h("span", { class: "sr" }, " (покана за приятелство)")
                  : null,
          ),
        ),
      ),
    ),
    // A screen on its way and not whole yet: a thin line along the top of the page, after a moment (app.css).
    h("div", { class: () => (coming() ? "coming on" : "coming"), "aria-hidden": "true" }),
    // A friend's challenge, wherever the player is (but in a game, or on the duels themselves).
    () => {
      const c = challenges()[0];
      return c && !playing() && !path().startsWith("/duel") ? challengeNotice(c) : null;
    },
    main,
  ]);
  start(
    main,
    [
      { path: /^\/$/, view: today },
      { path: /^\/play\/([a-z]+)$/, view: topic },
      { path: /^\/c\/([a-z0-9]{6,8})$/, view: challenge },
      { path: /^\/duel$/, view: duel },
      {
        path: /^\/duel\/live$/,
        view: later(() => import("./screens/live.ts").then((m) => m.liveDuel), "title", "card"),
      },
      { path: /^\/duel\/([0-9]+)$/, view: duelOne },
      { path: /^\/challenge$/, view: newChallenge },
      { path: /^\/challenge\/([0-9]+)$/, view: challengeFriend },
      { path: /^\/royal$/, view: later(() => import("./screens/royal.ts").then((m) => m.royal), "title", "card") },
      {
        path: /^\/almanac$/,
        view: later(() => import("./screens/almanac.ts").then((m) => m.almanac), "title", "tabs", "rows"),
      },
      { path: /^\/mistakes$/, view: mistakes },
      { path: /^\/issues$/, view: later(() => import("./screens/issues.ts").then((m) => m.issues), "title", "rows") },
      {
        path: /^\/issues\/([0-9]{1,5})$/,
        view: later(() => import("./screens/issues.ts").then((m) => m.issue), "title", "card", "rows"),
      },
      {
        path: /^\/year\/([0-9]{4})$/,
        view: later(() => import("./screens/year.ts").then((m) => m.year), "title", "card", "rows"),
      },
      { path: /^\/room$/, view: rooms },
      {
        path: /^\/ranks$/,
        view: later(() => import("./screens/ranks.ts").then((m) => m.ranks), "title", "tabs", "rows"),
      },
      {
        path: /^\/rewards$/,
        view: later(() => import("./screens/rewards.ts").then((m) => m.rewards), "tabs", "title", "card", "rows"),
      },
      {
        path: /^\/wardrobe$/,
        view: later(() => import("./screens/wardrobe.ts").then((m) => m.wardrobe), "tabs", "head", "card"),
      },
      {
        path: /^\/friends$/,
        view: later(() => import("./screens/friends.ts").then((m) => m.friends), "title", "rows"),
      },
      {
        path: /^\/settings$/,
        view: later(() => import("./screens/settings.ts").then((m) => m.settings), "title", "card", "card"),
      },
      {
        path: /^\/r\/([0-9]{6})$/,
        view: later(() => import("./screens/room.ts").then((m) => m.room), "title", "card"),
      },
      { path: /^\/f\/([a-z0-9]{8})$/, view: invite },
      { path: /^\/hand\/([A-Za-z0-9_-]{43})$/, view: handoff },
      {
        path: /^\/me$/,
        view: later(() => import("./screens/me.ts").then((m) => m.me), "tabs", "head", "card", "rows"),
      },
      {
        path: /^\/games$/,
        view: later(() => import("./screens/games.ts").then((m) => m.games), "title", "tabs", "rows"),
      },
      {
        path: /^\/games\/([0-9]+)$/,
        view: later(() => import("./screens/played.ts").then((m) => m.playedGame), "title", "card", "rows"),
      },
      {
        path: /^\/players\/([A-Za-z0-9_]{3,20})$/,
        view: later(() => import("./screens/player.ts").then((m) => m.playerProfile), "head", "card", "rows"),
      },
    ],
    missing,
  );
  // The four places' files, once the first screen is drawn and the browser has nothing else to do: a tap on one
  // draws it at once (Начало's is app.js itself).
  whenIdle(() => {
    for (const [href] of links) prefetch(href);
  });
  // In a game, a phone's bar of places steps aside (app.css): the question gets the screen.
  effect(() => document.documentElement.classList.toggle("playing", playing()));
  watchWaiting();
  prepareSound();
  preparePush();
}

/** Runs `fn` once the page has loaded and the browser is idle (where it can't say: a moment after the load). */
function whenIdle(fn: () => void): void {
  const idle = () => {
    if ("requestIdleCallback" in window) requestIdleCallback(() => fn(), { timeout: 3000 });
    else setTimeout(fn, 1000);
  };
  if (document.readyState === "complete") idle();
  else addEventListener("load", idle, { once: true });
}

/** A friend has challenged the player: who, until when, and play it or say no. */
function challengeNotice(c: Challenge): Child {
  const error = signal("");
  return h(
    "aside",
    { class: "challenge-notice", "aria-label": "Предизвикателство" },
    h(
      "p",
      { class: "challenge-text" },
      h("strong", null, `${c.from} те предизвика`),
      h("span", { class: "muted" }, c.started ? "Довърши играта си" : `Имаш време до ${until(c.expiresAt)}`),
    ),
    h(
      "div",
      { class: "challenge-actions" },
      h("button", { class: "btn rose inline", type: "button", onclick: () => playChallenge(c.id) }, "Играй"),
      c.started
        ? null
        : h(
            "button",
            {
              class: "btn inline",
              type: "button",
              onclick: async () => {
                try {
                  await api("DELETE", `/api/duels/${c.id}`);
                  challenges.update((list) => list.filter((x) => x.id !== c.id));
                  checkWaiting();
                } catch (err) {
                  error.set(errorText(err));
                }
              },
            },
            "Откажи",
          ),
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}
