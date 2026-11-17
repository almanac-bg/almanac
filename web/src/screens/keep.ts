// Keeping a guest's game: a guest's game lives in the one browser it began in, until an email keeps it everywhere.
// Asked in one quiet line in the day's „Утре“ card, from the second day played; at once in an app's own browser
// (Messenger, Instagram …: lib/embedded.ts), where the way out to the phone's browser is offered too, carrying the
// game (account.Handoff, taken on /hand/<token>). And the way in for a player who has a profile already, a tap from
// Начало and Профил.

import { type ApiError, api } from "../lib/api.ts";
import { inApp } from "../lib/app.ts";
import { type Child, effect, h, signal, when } from "../lib/dom.ts";
import { embedded, outsideLink } from "../lib/embedded.ts";
import { askToKeep } from "../lib/keep.ts";
import { go, title } from "../lib/router.ts";
import { type User, user } from "../state.ts";
import { notice, signIn } from "./settings.ts";

/** This page's app browser, if it's in one (never in the game's own app). */
const app = inApp ? null : embedded;

/** The line in „Утре“ that asks a guest to keep their game (`days`: the days played as far as they count, 1 or 2;
 * `streak` with today's), with the form a tap away; in an app's browser, the way out to the phone's too. */
export function keepLine(days: () => number, streak: () => number): Child {
  const open = signal(false);
  const asked = () => {
    const u = user();
    return !!u && askToKeep({ email: u.email, days: days(), embedded: !!app });
  };
  // What's at stake: the game in this app's browser only, or on this device.
  const stake = () => {
    if (app) return `Играта ти е само тук, ${app.app ? `в ${app.app}` : "в това приложение"}.`;
    const n = streak();
    return n >= 2 ? `Серията ти от ${n} дни е само на това устройство.` : "Играта ти е само на това устройство.";
  };
  const keep = (label: string) => h("button", { class: "link", type: "button", onclick: () => open.set(true) }, label);
  return when(asked, () =>
    when(
      open,
      () => h("div", { class: "stack keep-line" }, h("p", { class: "muted" }, stake), signIn(false)),
      () =>
        app
          ? outside(stake(), app.platform, keep("Или я запази с имейл"))
          : h("p", { class: "muted keep-line" }, stake, " ", keep("Запази я с имейл"), "."),
    ),
  );
}

/** In an app's own browser: the game is only here (`stake`), and the way to the phone's browser, with the game. On
 * Android a link opens it; on an iPhone no link can, so the link is copied, to paste in Safari. */
function outside(stake: string, platform: string, keep: Child): Child {
  // The link is made ahead, so that a tap opens or copies it at once (a browser lets a page do either only then).
  const url = signal("");
  let made = 0;
  const make = async () => {
    if (url.peek() && Date.now() - made < 20 * 60_000) return url.peek();
    const r = await api<{ url: string }>("POST", "/api/auth/handoff");
    made = Date.now();
    url.set(r.url);
    return r.url;
  };
  make().catch(() => {});
  const said = signal("");
  const fail = (err: unknown) => said.set((err as ApiError).message ?? "Не успяхме. Опитай пак.");
  const android = platform === "android";
  const ready = () => !!url.peek() && Date.now() - made < 20 * 60_000;
  const action = android
    ? h(
        "button",
        {
          class: "btn",
          type: "button",
          onclick: () => {
            if (ready()) location.assign(outsideLink(url.peek()));
            else make().then((u) => location.assign(outsideLink(u)), fail);
          },
        },
        "Отвори в браузъра",
      )
    : h(
        "button",
        {
          class: "btn",
          type: "button",
          onclick: () => {
            // Where there's no clipboard to write to (an older iPhone, some apps' browsers), the calls themselves
            // throw: the link is shown all the same.
            let copy: Promise<void>;
            try {
              copy = ready()
                ? navigator.clipboard.writeText(url.peek())
                : navigator.clipboard.write([
                    new ClipboardItem({ "text/plain": make().then((u) => new Blob([u], { type: "text/plain" })) }),
                  ]);
            } catch (err) {
              copy = Promise.reject(err);
            }
            copy.then(
              () => said.set("Копирано. Отвори Safari и постави връзката горе, в адреса."),
              () => make().then((u) => said.set(u), fail), // no clipboard here: the link, to copy by hand
            );
          },
        },
        "Копирай връзката",
      );
  return h(
    "div",
    { class: "stack keep-line" },
    h(
      "p",
      { class: "muted" },
      android
        ? `${stake} Отвори я в браузъра на телефона и утре ще те чака там.`
        : `${stake} Копирай връзката и я отвори в Safari: играта ти идва с нея.`,
    ),
    h("div", { class: "remind-actions" }, action, keep),
    () => said() && h("p", { class: "muted keep-said", role: "status" }, said()),
  );
}

/** The way in for a player who has a profile already (a new phone, another browser): a quiet line (`label`) that
 * opens the form in place (`open`: opened from the start). Signed in, `signedIn` draws the screen again, as the
 * profile has it. */
export function haveProfile(signedIn: () => void, label = "Имаш профил? Влез", open = false): Child {
  const opened = signal(open);
  effect(() => {
    if (opened() && user()?.email) signedIn();
  });
  return () =>
    opened()
      ? h("section", { class: "card keep-card" }, h("h2", { class: "card-title" }, "Влез в профила си"), signIn(false))
      : h(
          "p",
          { class: "day-next" },
          h("button", { class: "link", type: "button", onclick: () => opened.set(true) }, label),
        );
}

/** /hand/<token>: a game brought from an app's own browser (keepLine), taken here, once; then Начало, which says so. */
export function handoff([token = ""]: string[]) {
  title();
  api<{ user: User }>("POST", "/api/auth/hand", { token }).then(
    (r) => {
      user.set(r.user);
      notice.set("Готово: играта ти е тук.");
      go("/", true);
    },
    (err: ApiError) => {
      notice.set(err.message);
      go("/", true);
    },
  );
  return h("section", { class: "screen" }, h("p", { class: "muted" }, "…"));
}
