// Keeping a guest's game: a guest's game lives in the one browser it began in, until an email keeps it everywhere.
// Asked in one quiet line under the day's result (`.asks`), from the second day played. In an app's own browser (Messenger,
// Instagram …: lib/embedded.ts) the day's result's action is the way out to the phone's browser, with the game
// (exitWay: account.Handoff, its token in Днес's address while it's offered, taken there by takeHand), and the cover
// has one small line for a game kept there already (coverExit); a game brought there lands on the day's result, whose
// action is then the ask to keep it and be reminded (handedIn). Where no notification can come, the day's reminder
// by mail asks for the email instead (mailAsk), and keeps the game with it. On Профил, from the first game
// (keepGame), beside the way to the sign-in page for a profile from elsewhere; and that way in open on Днес for one
// come from the streak's mail to a browser signed out (haveProfile). Whichever way the
// code is put in, what came of it is said (lib/keep.ts, keptWords); in Meta's and TikTok's browsers no email or code
// is asked for at all (signIn).

import { api, errorText } from "../lib/api.ts";
import { type Child, computed, h, onCleanup, signal, slot, when } from "../lib/dom.ts";
import { embedded, handMark, handToken, outsideLink } from "../lib/embedded.ts";
import { askToKeep } from "../lib/keep.ts";
import { fragment } from "../lib/router.ts";
import { notice, setLook, type User, user } from "../state.ts";
import { emailWords } from "../ui.ts";
import { noEmail, noEmailLine, signIn } from "./signin.ts";

/** This page's app browser, if it's in one. */
export const app = embedded;

/** What the first results' ask to be reminded says first (by mail, mailAsk; by notification, Днес's): a newcomer from a
 * link or a search doesn't know yet that the ten are new every day. */
export const daily = "Всеки ден излизат нови десет.";

/** What keeping the game is for, under the email's field. */
const keepNote = "Ще ти пратим код, за да потвърдиш имейла. Така серията и Алманахът ти са с теб на всяко устройство.";

/** What a guest's game risks, while they're to be asked to keep it (`days`: the days played as far as they count, 1
 * or 2; `streak` with today's): the game in this app's browser only, or on this device. Null once it's kept. */
export function keepStake(days: () => number, streak: () => number): () => string | null {
  return () => {
    const u = user();
    if (!u || !askToKeep({ email: u.email, days: days(), embedded: !!app })) return null;
    if (app)
      return `Играта ти е само тук, ${app.app ? `${/^[ВвФфVvFf]/.test(app.app) ? "във" : "в"} ${app.app}` : "в това приложение"}.`;
    const n = streak();
    return n >= 2 ? `Серията ти от ${n}\u00a0дни е само на това устройство.` : "Играта ти е само на това устройство.";
  };
}

/** The line under the day's result that asks a guest to keep their game (keepStake), with the form a tap away; none in an app's
 * browser, where the way out is the result's action (exitWay). Quiet while the reminder by mail asks for the email
 * (`quiet`). Kept, it says so in its place; signed in to another profile, `signedIn` draws the page again as theirs,
 * and the notice says so. */
export function keepLine(stake: () => string | null, quiet: () => boolean, signedIn: () => void): Child {
  const open = signal(false);
  const said = signal("");
  const keep = (label: string) => h("button", { class: "link", type: "button", onclick: () => open.set(true) }, label);
  return [
    () => said() && h("p", { class: "muted keep-line", role: "status" }, said()),
    when(
      () => !app && !!stake() && !quiet(),
      () =>
        when(
          open,
          () =>
            h(
              "div",
              { class: "stack keep-line" },
              h("p", { class: "muted" }, stake),
              signIn({
                form: "keep-line",
                primary: false,
                note: keepNote,
                done: (s, now) => (now.id === user.peek()?.id ? said.set(s) : told(signedIn)(s)),
              }),
            ),
          () => h("p", { class: "muted keep-line" }, stake, " ", keep("Запази я с имейл"), "."),
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
 * said first, is what it risks till then). What came of it is said in its place, or, the code signing in to another
 * profile, by the notice as `signedIn` draws the page again as theirs (none: in place). `no`: a „Не сега“ under it
 * (Днес's ask); `folded`: the guest's form a tap away (Настройки, where the profile's own is further down);
 * `turning`: told as it's being turned on (before a guest's email is set as theirs); `yes`: told once it's on, with
 * the mail as it is now; `primary`: it's the page's one action (the first results'), and says first that the ten are
 * new every day (daily). */
export function mailAsk({
  stake,
  no,
  folded = false,
  turning,
  yes,
  primary = false,
  signedIn,
}: {
  signedIn?: () => void;
  stake?: () => string | null;
  no?: () => void;
  folded?: boolean;
  turning?: () => void;
  yes?: (now: MailPrefs) => void;
  primary?: boolean;
}): Child {
  const btn = primary ? "btn primary" : "btn";
  const said = signal("");
  const error = signal("");
  const saving = signal(false);
  const open = signal(!folded);
  const email = computed(() => user()?.email ?? "");
  const turnOn = async (kept: string, other = false) => {
    saving.set(true);
    error.set("");
    turning?.();
    try {
      const r = await api<MailPrefs>("PATCH", "/api/mail/prefs", { kind: "day", on: true });
      const words = `${kept || "Готово."} ${r.can ? "Ще ти напомняме по имейл, ако броят още те чака." : "Напомнянията ще идват като известия, както досега."}`;
      yes?.(r);
      if (other && signedIn) told(signedIn)(words);
      else said.set(words);
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
      // On the first results, first what a newcomer may not know yet: the ten are new every day.
      primary ? `${daily} ` : null,
      // The address broken after its @ or before a dot, never at any letter (twice the text on a narrow phone).
      to ? ["Да ти пишем на ", emailWords(to), ", ако"] : "Да ти пишем, ако",
      " броят още те чака? Веднъж на ден, около часа, в който играеш.",
    );
  const nope = () => (no ? h("button", { class: "link tap", type: "button", onclick: no }, "Не сега") : null);
  return [
    () => {
      if (said()) return h("p", { class: "muted", role: "status" }, said());
      if (saving()) return h("p", { class: "muted" }, "…");
      const to = email();
      // Where no email may be asked for, a guest isn't offered mail at all (the page says why, once).
      if (!to && noEmail) return null;
      if (to)
        return [
          lead(to),
          h(
            "div",
            { class: "remind-actions" },
            h("button", { class: btn, type: "button", onclick: () => turnOn("") }, "Напомняй ми по имейл"),
            nope(),
          ),
        ];
      return [
        stake ? () => (stake() ? h("p", { class: "muted" }, stake()) : null) : null,
        lead(""),
        when(
          open,
          () => [
            signIn({
              form: "remind-mail",
              primary,
              send: "Напомняй ми по имейл",
              note: keepNote,
              done: (kept, now) => void turnOn(kept, now.id !== user.peek()?.id),
            }),
            no ? h("div", { class: "remind-actions" }, nope()) : null,
          ],
          () =>
            h(
              "div",
              { class: "remind-actions" },
              h("button", { class: btn, type: "button", onclick: () => open.set(true) }, "Напомняй ми по имейл"),
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

/** Профил's line to a guest, from the first game, one quiet line: the game is only here, „Запази я с имейл“ (a tap
 * opens its form in the line's place), „Имаш профил? Влез“ (a profile from elsewhere: the sign-in page, signInPage).
 * Once the code is in, `signedIn` draws Профил again as the profile has it, and it says what came of it (notice). */
export function keepGame(signedIn: () => void): Child {
  // Where no email is asked for: no offer of one, only why not, and the way (the phone's browser).
  if (noEmail) return h("p", { class: "muted keep-line" }, `Играта ти е само на това устройство. ${noEmailLine}`);
  const keeping = signal(false);
  return () =>
    keeping()
      ? h(
          "section",
          { class: "card keep-card" },
          h("h2", { class: "card-title" }, "Запази играта си"),
          signIn({ form: "keep-game", primary: false, note: keepNote, done: told(signedIn) }),
        )
      : h(
          "p",
          { class: "muted keep-line" },
          "Играта ти е само на това устройство. ",
          h("button", { class: "link", type: "button", onclick: () => keeping.set(true) }, "Запази я с имейл"),
          " · ",
          h("a", { class: "link", href: "/signin" }, "Имаш профил? Влез"),
        );
}

/** The way in for a player who has a profile already, come from the streak's mail to a browser signed out (Днес):
 * the form open, on a card of its own. Signed in, `signedIn` draws the screen again, as the profile has it, and the
 * screen says what came of it (notice). None where no email is asked for: the way in is the phone's browser. */
export function haveProfile(signedIn: () => void): Child {
  if (noEmail) return null;
  return h("section", { class: "card keep-card" }, h("h2", { class: "card-title" }, "Влез в профила си"), () =>
    signIn({ form: "have-profile", primary: false, done: told(signedIn) }),
  );
}

/** The menu that opens a page in the phone's own browser, as an app's browser has it, named: on an iPhone, Safari;
 * on one line, never broken at its arrow. */
const menuWay = () =>
  app?.platform === "ios" ? "···\u00a0→\u00a0Отвори\u00a0в\u00a0Safari" : "···\u00a0→\u00a0Отвори\u00a0в\u00a0браузъра";

/** How often a page left on screen asks for a new link: well within a link's half hour (account.HandoffTTL), so that
 * the one in the address doesn't die while it's being opened. */
const handFresh = 20 * 60_000;

/** The way out of an app's own browser, with the game (account.Handoff): the result's action there. The link's token
 * is written into Днес's address (its fragment) while this is on screen, and only then, so that the app's own „Open
 * in browser“ takes it along; a new one is asked for as the page comes back into view (the one before may have been
 * used there), and every 20 minutes on screen; the ones before work on till they're used or out of time. On Android a button opens the phone's browser at that
 * address; elsewhere (an iPhone), where no link can, a button copies it for the phone's browser; under either, the
 * app's menu, named. Where the app's browser may be trusted with a form (lib/embedded.ts, forms), keeping the game
 * with an email is a tap away too. `stake`: what the game risks here. */
export function exitWay(stake: () => string | null): Child {
  const said = signal("");
  let gone = false;
  let held = false;
  const hold = async (): Promise<void> => {
    const r = await api<{ token: string }>("POST", "/api/auth/handoff");
    if (!gone) {
      held = true;
      // On the page's own entry, even while the game's end is still going back to it (router.ts).
      fragment(`${handMark}${r.token}`, () => !gone);
    }
  };
  const fail = (err: unknown) => said.set(errorText(err));
  hold().catch(fail);
  const back = () => {
    if (!document.hidden) hold().catch(() => {});
  };
  document.addEventListener("visibilitychange", back);
  const every = setInterval(back, handFresh);
  onCleanup(() => {
    gone = true;
    document.removeEventListener("visibilitychange", back);
    clearInterval(every);
    if (handToken(location.hash)) history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  });
  const android = app?.platform === "android";
  const open = () => {
    if (held) location.assign(outsideLink(location.href));
    else hold().then(() => location.assign(outsideLink(location.href)), fail);
  };
  // Where no menu says it (an app that has none), the address to copy by hand into the phone's browser.
  const copy = () => {
    const at = () => `${location.origin}/${location.hash}`;
    let done: Promise<void>;
    try {
      done = navigator.clipboard.writeText(at());
    } catch (err) {
      done = Promise.reject(err);
    }
    done.then(
      () =>
        said.set(
          `Копирано. Отвори ${app?.platform === "ios" ? "Safari" : "браузъра на телефона"} и постави връзката в адресното поле.`,
        ),
      () => said.set(at()),
    );
  };
  const keeping = signal(false);
  return h(
    "div",
    { class: "stack keep-line exit-way" },
    h("p", { class: "muted" }, () =>
      [stake(), "Продължи в браузъра на телефона и утре играта ще те чака там."].filter(Boolean).join(" "),
    ),
    // The way out is a button either way: on Android it opens the phone's browser; where no link can (an iPhone), it
    // copies the address for it. Under it, the app's own menu, named.
    android
      ? h("button", { class: "btn primary", type: "button", onclick: open }, "Отвори в браузъра")
      : h(
          "button",
          { class: "btn primary", type: "button", onclick: copy },
          app?.platform === "ios" ? "Копирай връзката за Safari" : "Копирай връзката за браузъра",
        ),
    h("p", { class: "exit-menu" }, "Или от менюто на приложението: ", h("b", null, menuWay())),
    app?.forms
      ? h(
          "div",
          { class: "remind-actions" },
          h("button", { class: "link tap", type: "button", onclick: () => keeping.set(true) }, "Или я запази с имейл"),
        )
      : null,
    () => (keeping() ? signIn({ form: "exit-keep", primary: false, note: keepNote, done: (s) => said.set(s) }) : null),
    () => said() && h("p", { class: "muted keep-said", role: "status" }, said()),
  );
}

/** The cover's one small line in an app's own browser, under „Започни“: a game kept in the phone's browser is there.
 * On Android a tap opens it; elsewhere (an iPhone),
 * where no link can, the line names the app's menu instead, no button that would do nothing. */
export function coverExit(): Child {
  if (!app) return null;
  if (app.platform !== "android")
    return h("p", { class: "small issue-exit" }, "Имаш игра в браузъра? Отвори я там: ", h("b", null, menuWay()));
  const go = () => location.assign(outsideLink(`${location.origin}/`));
  return h(
    "p",
    { class: "small issue-exit" },
    "Имаш игра в браузъра? ",
    h("button", { class: "link", type: "button", onclick: go }, "Отвори я там"),
  );
}

/** Whether a game was brought to this browser by a Handoff on this visit (takeHand): Днес's result then asks first
 * to keep it and be reminded (screens/today.ts). */
export const handedIn = signal(false);

/** The game a handoff's link brings (account.Handing): whose, and whether this is the browser that made it. */
interface Handing {
  name: string;
  mine?: boolean;
}

/** A game brought by a Handoff's token found in Днес's address (handToken, which Днес takes out of it at once):
 * taken here with one tap that names the game; then `done` draws Днес as it is, the day's result with the ask to keep
 * the game and be reminded, and the notice says what came of it. The app's browser it came from stays signed in
 * (account.TakeHandoff). Opened where it was made, nothing changes and nothing is asked. */
export function takeHand(token: string, done: () => void): Child {
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  const finish = (words: string) => {
    if (words) notice.set(words);
    done();
  };
  const take = async () => {
    const before = user.peek();
    const r = await api<{ user: User; avatar?: string }>("POST", "/api/auth/hand", { token });
    const same = before?.id === r.user.id;
    setLook(r.avatar ?? "", r.user.id);
    user.set(r.user);
    if (!same) handedIn.set(true);
    finish(same ? "" : "Готово: играта ти е тук.");
  };
  api<{ game: Handing }>("POST", "/api/auth/hand/look", { token }).then(
    (r) =>
      r.game.mine
        ? take().catch((err) => finish(errorText(err)))
        : screen.show(() => confirmTake(r.game, take, finish)),
    (err) => finish(errorText(err)),
  );
  return h("section", { class: "screen" }, screen);
}

/** The one tap that takes a game brought by a link here, naming whose it is: a link opened is never taken unseen. */
function confirmTake(game: Handing, take: () => Promise<void>, finish: (words: string) => void): Child {
  const busy = signal(false);
  return h(
    "form",
    {
      class: "stack hand-take",
      onsubmit: async (e: SubmitEvent) => {
        e.preventDefault();
        busy.set(true);
        try {
          await take();
        } catch (err) {
          finish(errorText(err));
        } finally {
          busy.set(false);
        }
      },
    },
    h("div", { class: "intro" }, h("h1", null, "Продължи играта тук")),
    h("p", { class: "lead" }, "Тази връзка пренася тук играта на ", h("strong", null, game.name), "."),
    h("button", { class: "btn primary", disabled: busy }, "Продължи тук"),
    h("button", { class: "link tap", type: "button", onclick: () => finish("") }, "Отказ"),
  );
}
