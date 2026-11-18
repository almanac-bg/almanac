// Keeping a guest's game: a guest's game lives in the one browser it began in, until an email keeps it everywhere.
// Asked in one quiet line in the day's „Утре“ card, from the second day played; at once in an app's own browser
// (Messenger, Instagram …: lib/embedded.ts), where the way out to the phone's browser is offered too, moving the
// game (account.Handoff, taken on /hand/<token> with a tap). Where no notification can come, the day's reminder by
// mail asks for the email instead (mailAsk), and keeps the game with it. On Профил, from the first game (keepGame).
// And the way in for a player who has a profile already, a tap from Начало and Профил. Whichever way the code is put
// in, what came of it is said (lib/keep.ts, keptWords).

import { type ApiError, api, errorText } from "../lib/api.ts";
import { inApp } from "../lib/app.ts";
import { type Child, computed, h, signal, slot, when } from "../lib/dom.ts";
import { embedded, outsideLink } from "../lib/embedded.ts";
import { askToKeep } from "../lib/keep.ts";
import { go, title } from "../lib/router.ts";
import { notice, type User, user } from "../state.ts";
import { failure } from "../ui.ts";
import { signIn } from "./signin.ts";

/** This page's app browser, if it's in one (never in the game's own app). */
export const app = inApp ? null : embedded;

/** What keeping the game is for, under the email's field. */
const keepNote =
  "Пращаме ти код, за да потвърдиш имейла. Серията, точките и научените факти остават с теб на всяко устройство.";

/** What a guest's game risks, while they're to be asked to keep it (`days`: the days played as far as they count, 1
 * or 2; `streak` with today's): the game in this app's browser only, or on this device. Null once it's kept. */
export function keepStake(days: () => number, streak: () => number): () => string | null {
  return () => {
    const u = user();
    if (!u || !askToKeep({ email: u.email, days: days(), embedded: !!app })) return null;
    if (app)
      return `Играта ти е само тук, ${app.app ? `${/^[ВвФфVvFf]/.test(app.app) ? "във" : "в"} ${app.app}` : "в това приложение"}.`;
    const n = streak();
    return n >= 2 ? `Серията ти от ${n} дни е само на това устройство.` : "Играта ти е само на това устройство.";
  };
}

/** The line in „Утре“ that asks a guest to keep their game (keepStake), with the form a tap away; in an app's
 * browser, the way out to the phone's too. Quiet while the reminder by mail asks for the email (`quiet`). Kept, it
 * says so in its place. */
export function keepLine(stake: () => string | null, quiet: () => boolean): Child {
  const open = signal(false);
  const said = signal("");
  const keep = (label: string) => h("button", { class: "link", type: "button", onclick: () => open.set(true) }, label);
  return [
    () => said() && h("p", { class: "muted keep-line", role: "status" }, said()),
    when(
      () => !!stake() && !quiet(),
      () =>
        when(
          open,
          () =>
            h(
              "div",
              { class: "stack keep-line" },
              h("p", { class: "muted" }, stake),
              signIn({ primary: false, note: keepNote, enter: "Потвърди", done: (s) => said.set(s) }),
            ),
          () =>
            app
              ? outside(stake() ?? "", app.platform, keep("Или я запази с имейл"))
              : h("p", { class: "muted keep-line" }, stake, " ", keep("Запази я с имейл"), "."),
        ),
    ),
  ];
}

/** The mail a player with an email gets (server/streakmail.go, mailPrefs): the day's reminder, the mail when a streak
 * ends, and whether mail goes to them at all (`can`: an email, and no notification reaching them). */
export interface MailPrefs {
  streak: boolean;
  day: boolean;
  can: boolean;
}

/** The day's reminder by mail (server/daymail.go), asked for where no notification can come here. A player with an
 * email turns it on with a tap; a guest gives one, and the code sent to it, which keeps their game too (`stake`,
 * said first, is what it risks till then). What came of it is said in its place. `no`: a „Не сега“ under it
 * (Начало's ask); `folded`: the guest's form a tap away (Настройки, where the profile's own is further down);
 * `turning`: told as it's being turned on (before a guest's email is set as theirs); `yes`: told once it's on, with
 * the mail as it is now. */
export function mailAsk({
  stake,
  no,
  folded = false,
  turning,
  yes,
}: {
  stake?: () => string | null;
  no?: () => void;
  folded?: boolean;
  turning?: () => void;
  yes?: (now: MailPrefs) => void;
}): Child {
  const said = signal("");
  const error = signal("");
  const saving = signal(false);
  const open = signal(!folded);
  const email = computed(() => user()?.email ?? "");
  const turnOn = async (kept: string) => {
    saving.set(true);
    error.set("");
    turning?.();
    try {
      const r = await api<MailPrefs>("PATCH", "/api/mail/prefs", { kind: "day", on: true });
      said.set(
        `${kept || "Готово."} ${r.can ? "Ще ти напомняме по имейл, ако въпросите още те чакат." : "Напомнянията ще идват като известия, както досега."}`,
      );
      yes?.(r);
    } catch (err) {
      error.set(errorText(err));
    } finally {
      saving.set(false);
    }
  };
  const lead = (to: string) =>
    h(
      "p",
      { class: "muted" },
      `Да ти пишем${to ? ` на ${to}` : ""}, ако въпросите още те чакат? Веднъж на ден, около часа, в който играеш.`,
    );
  const nope = () => (no ? h("button", { class: "link tap", type: "button", onclick: no }, "Не сега") : null);
  return [
    () => {
      if (said()) return h("p", { class: "muted", role: "status" }, said());
      if (saving()) return h("p", { class: "muted" }, "…");
      const to = email();
      if (to)
        return [
          lead(to),
          h(
            "div",
            { class: "remind-actions" },
            h("button", { class: "btn", type: "button", onclick: () => turnOn("") }, "Напомняй ми по имейл"),
            nope(),
          ),
        ];
      return [
        stake ? () => (stake() ? h("p", { class: "muted" }, stake()) : null) : null,
        lead(""),
        when(
          open,
          () => [
            signIn({ primary: false, send: "Напомняй ми по имейл", note: keepNote, enter: "Потвърди", done: turnOn }),
            no ? h("div", { class: "remind-actions" }, nope()) : null,
          ],
          () =>
            h(
              "div",
              { class: "remind-actions" },
              h("button", { class: "btn", type: "button", onclick: () => open.set(true) }, "Напомняй ми по имейл"),
              nope(),
            ),
        ),
      ];
    },
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  ];
}

/** A code put in on a screen that draws itself again as the profile has it (`signedIn`): what came of it is kept to
 * be said there (notice), and the screen drawn once the player is set, whatever of this screen is gone by then. */
const told =
  (signedIn: () => void) =>
  (said: string): void => {
    notice.set(said);
    queueMicrotask(signedIn);
  };

/** Профил's ask to a guest to keep their game, from the first game: a quiet line that opens the form in place; once
 * the code is in, `signedIn` draws Профил again as the profile has it, and it says what came of it (notice). */
export function keepGame(signedIn: () => void): Child {
  const opened = signal(false);
  return () =>
    opened()
      ? h(
          "section",
          { class: "card keep-card" },
          h("h2", { class: "card-title" }, "Запази играта си"),
          signIn({ primary: false, note: keepNote, enter: "Потвърди", done: told(signedIn) }),
        )
      : h(
          "p",
          { class: "muted keep-line" },
          "Играта ти е само на това устройство. ",
          h("button", { class: "link", type: "button", onclick: () => opened.set(true) }, "Запази я с имейл"),
          ".",
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
  const fail = (err: unknown) => said.set(errorText(err));
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
              () => said.set("Копирано. Отвори Safari и постави връзката в адресното поле."),
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
 * profile has it, and the screen says what came of it (notice). */
export function haveProfile(signedIn: () => void, label = "Имаш профил? Влез", open = false): Child {
  const opened = signal(open);
  return () =>
    opened()
      ? h(
          "section",
          { class: "card keep-card" },
          h("h2", { class: "card-title" }, "Влез в профила си"),
          signIn({ primary: false, done: told(signedIn) }),
        )
      : h(
          "p",
          { class: "day-next" },
          h("button", { class: "link", type: "button", onclick: () => opened.set(true) }, label),
        );
}

/** The game a handoff's link brings (account.Handing): whose, and on how many days it was played. */
interface Handing {
  name: string;
  days: number;
}

/** /hand/<token>: a game brought from an app's own browser (keepLine), taken here once, when the player taps for it
 * (a link that opens by itself, as the app does with one, or that someone else sent, takes nothing on its own); then
 * Начало, which says so. The game moves: where it was, it's gone (account.TakeHandoff). The page says first whose
 * game it is, and on how many days it was played, so that a link from someone else is seen to be theirs; or why it
 * can't come here (a profile here, or a game of this browser's own: two games are joined only by an email). */
export function handoff([token = ""]: string[]) {
  title("Продължи играта тук");
  const busy = signal(false);
  const take = () => {
    busy.set(true);
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
  };
  const offer = (game: Handing) =>
    h(
      "div",
      { class: "stack" },
      h(
        "p",
        { class: "lead" },
        "Играта на ",
        h("strong", null, game.name),
        " ще продължи тук. Там, където е започната, вече няма да я има.",
      ),
      h(
        "p",
        { class: "muted" },
        game.days > 0 ? `${game.days} ${game.days === 1 ? "ден" : "дни"} игра. ` : "",
        "Продължи само ако играта е твоя.",
      ),
      h("button", { class: "btn primary", type: "button", onclick: take, disabled: busy }, "Продължи тук"),
      h("a", { class: "link tap", href: "/" }, "Откажи"),
    );
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  const look = () => {
    api<{ game: Handing }>("POST", "/api/auth/hand/look", { token }).then(
      (r) => screen.show(() => offer(r.game)),
      (err) => screen.show(() => failure(err, look)),
    );
  };
  look();
  return h("section", { class: "screen" }, h("div", { class: "intro" }, h("h1", null, "Продължи играта тук")), screen);
}
