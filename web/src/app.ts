// АЛМАНАХ's web client: the mark and the name, the four main places (in the header on a big screen, a bar at the
// bottom of a phone's), and the screen the router puts under them.

import { loadPictures } from "./art/picture.ts";
import { type ApiError, api } from "./lib/api.ts";
import { type Child, effect, h, mount, signal } from "./lib/dom.ts";
import { reportErrors } from "./lib/errors.ts";
import { applyPrefs } from "./lib/prefs.ts";
import { path, start } from "./lib/router.ts";
import { prepareSound } from "./lib/sound.ts";
import { almanac } from "./screens/almanac.ts";
import { arena } from "./screens/arena.ts";
import { duel, duelOne, playChallenge, until } from "./screens/duel.ts";
import { friends } from "./screens/friends.ts";
import { invite } from "./screens/invite.ts";
import { liveDuel } from "./screens/live.ts";
import { me } from "./screens/me.ts";
import { challengeGone, missing } from "./screens/missing.ts";
import { topic } from "./screens/play.ts";
import { playerProfile } from "./screens/player.ts";
import { ranks } from "./screens/ranks.ts";
import { rewards } from "./screens/rewards.ts";
import { arenaGame, room } from "./screens/room.ts";
import { rooms } from "./screens/rooms.ts";
import { royal } from "./screens/royal.ts";
import { settings } from "./screens/settings.ts";
import { today } from "./screens/today.ts";
import { wardrobe } from "./screens/wardrobe.ts";
import { type Challenge, challenges, checkWaiting, friendRequests, playing, watchWaiting } from "./state.ts";

/**
 * The four main places: where each goes, its name and icon, and which paths are part of it. Playing (every way) starts
 * from Начало; Профил holds what a player has: their rewards, their wardrobe, their almanac and their settings.
 */
const links: [href: string, label: string, icon: string, here: (p: string) => boolean][] = [
  ["/", "Начало", "home", (p) => /^\/($|play\/|duel|arena|royal|room|r\/)/.test(p)],
  ["/friends", "Приятели", "users", (p) => /^\/(friends|together|f\/)/.test(p)],
  ["/ranks", "Класации", "podium", (p) => p === "/ranks"],
  ["/me", "Профил", "user", (p) => /^\/(me|settings|rewards|wardrobe|almanac)$/.test(p)],
];

reportErrors();
applyPrefs();
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
      { path: /^\/c\/([a-z0-9]{6})$/, view: challengeGone },
      { path: /^\/duel$/, view: duel },
      { path: /^\/duel\/live$/, view: liveDuel },
      { path: /^\/duel\/([0-9]+)$/, view: duelOne },
      { path: /^\/arena$/, view: arena },
      { path: /^\/arena\/([0-9]{6})$/, view: arenaGame },
      { path: /^\/royal$/, view: royal },
      { path: /^\/almanac$/, view: almanac },
      { path: /^\/room$/, view: rooms },
      { path: /^\/ranks$/, view: ranks },
      { path: /^\/rewards$/, view: rewards },
      { path: /^\/wardrobe$/, view: wardrobe },
      { path: /^\/friends$/, view: friends },
      { path: /^\/settings$/, view: settings },
      // Where friends were before: a link in an old notification still lands somewhere that makes sense.
      { path: /^\/together$/, view: friends },
      { path: /^\/r\/([0-9]{6})$/, view: room },
      { path: /^\/f\/([a-z0-9]{8})$/, view: invite },
      { path: /^\/me$/, view: me },
      { path: /^\/players\/([A-Za-z0-9_]{3,20})$/, view: playerProfile },
    ],
    missing,
  );
  // In a game, a phone's bar of places steps aside (app.css): the question gets the screen.
  effect(() => document.documentElement.classList.toggle("playing", playing()));
  watchWaiting();
  prepareSound();
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
      h("strong", null, `${c.from} те предизвика на дуел`),
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
                  error.set((err as ApiError).message);
                }
              },
            },
            "Откажи",
          ),
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}
