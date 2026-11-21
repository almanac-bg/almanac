// Keeping a guest's game: a guest's game lives in the one browser it began in, until an email keeps it everywhere.
// Asked in one quiet line in the day's „Утре“ card, from the second day played. In an app's own browser (Messenger,
// Instagram …: lib/embedded.ts) the day's result's action is the way out to the phone's browser, with the game
// (exitWay: account.Handoff, its token in Днес's address while it's offered, taken there by takeHand), and the cover
// has one small line for a game kept there already (coverExit); a game brought there lands on the day's result, whose
// action is then the ask to keep it and be reminded (handedIn). Where no notification can come, the day's reminder
// by mail asks for the email instead (mailAsk), and keeps the game with it. On Профил, from the first game
// (keepGame). And the way in for a player who has a profile already, a tap from Начало and Профил. Whichever way the
// code is put in, what came of it is said (lib/keep.ts, keptWords); in Meta's and TikTok's browsers no email or code
// is asked for at all (signIn).

import { type ApiError, api, errorText } from "../lib/api.ts";
import { type Child, computed, h, onCleanup, signal, slot, when } from "../lib/dom.ts";
import { embedded, handMark, handToken, outsideLink } from "../lib/embedded.ts";
import { askToKeep } from "../lib/keep.ts";
import { fragment } from "../lib/router.ts";
import { notice, type User, user } from "../state.ts";
import { signIn } from "./signin.ts";

/** This page's app browser, if it's in one. */
export const app = embedded;

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

/** The line in „Утре“ that asks a guest to keep their game (keepStake), with the form a tap away; none in an app's
 * browser, where the way out is the result's action (exitWay). Quiet while the reminder by mail asks for the email
 * (`quiet`). Kept, it says so in its place. */
export function keepLine(stake: () => string | null, quiet: () => boolean): Child {
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
                enter: "Потвърди",
                done: (s) => said.set(s),
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
 * said first, is what it risks till then). What came of it is said in its place. `no`: a „Не сега“ under it
 * (Начало's ask); `folded`: the guest's form a tap away (Настройки, where the profile's own is further down);
 * `turning`: told as it's being turned on (before a guest's email is set as theirs); `yes`: told once it's on, with
 * the mail as it is now; `primary`: it's the page's one action (the first results'). */
export function mailAsk({
  stake,
  no,
  folded = false,
  turning,
  yes,
  primary = false,
}: {
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
  const turnOn = async (kept: string) => {
    saving.set(true);
    error.set("");
    turning?.();
    try {
      const r = await api<MailPrefs>("PATCH", "/api/mail/prefs", { kind: "day", on: true });
      said.set(
        `${kept || "Готово."} ${r.can ? "Ще ти напомняме по имейл, ако броят още те чака." : "Напомнянията ще идват като известия, както досега."}`,
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
      `Да ти пишем${to ? ` на ${to}` : ""}, ако броят още те чака? Веднъж на ден, около часа, в който играеш.`,
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
              enter: "Потвърди",
              done: turnOn,
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
          signIn({ form: "keep-game", primary: false, note: keepNote, enter: "Потвърди", done: told(signedIn) }),
        )
      : h(
          "p",
          { class: "muted keep-line" },
          "Играта ти е само на това устройство. ",
          h("button", { class: "link", type: "button", onclick: () => opened.set(true) }, "Запази я с имейл"),
          ".",
        );
}

/** The way in for a player who has a profile already (a new phone, another browser): a quiet line (`label`) that
 * opens the form in place (`open`: opened from the start). Signed in, `signedIn` draws the screen again, as the
 * profile has it, and the screen says what came of it (notice). `primary`: the form is the page's one action (Вход). */
export function haveProfile(
  signedIn: () => void,
  label = "Имаш профил? Влез",
  open = false,
  email: () => string = () => "",
  primary = false,
): Child {
  const opened = signal(open);
  return () =>
    opened()
      ? h("section", { class: "card keep-card" }, h("h2", { class: "card-title" }, "Влез в профила си"), () =>
          signIn({ form: "have-profile", primary, done: told(signedIn), email: email() }),
        )
      : h(
          "p",
          { class: "day-next" },
          h("button", { class: "link", type: "button", onclick: () => opened.set(true) }, label),
        );
}

/** The menu that opens a page in the phone's own browser, as an app's browser has it, named: on an iPhone, Safari. */
const menuWay = () => (app?.platform === "ios" ? "··· → Отвори в Safari" : "··· → Отвори в браузъра");

/** The way out of an app's own browser, with the game (account.Handoff): the result's action there. The link's token
 * is written into Днес's address (its fragment) while this is on screen, and only then, so that the app's own „Open
 * in browser“ takes it along; it's asked for again as the page comes back into view, and changes only when it has
 * less than 10 minutes left (account.HandoffRotate). On Android a button opens the phone's browser at that address;
 * on an iPhone, where no link can, one line names the app's menu. The number another browser may ask for is said
 * under it. Where the app's browser may be trusted with a form (lib/embedded.ts, forms), keeping the game with an
 * email is a tap away too. `stake`: what the game risks here. */
export function exitWay(stake: () => string | null): Child {
  const offer = signal<{ token: string; number: number } | null>(null);
  const said = signal("");
  let gone = false;
  const hold = async (): Promise<string> => {
    const r = await api<{ token: string; number: number }>("POST", "/api/auth/handoff", {
      token: offer.peek()?.token ?? "",
    });
    if (!gone) {
      offer.set(r);
      // On the page's own entry, even while the game's end is still going back to it (router.ts).
      fragment(`${handMark}${r.token}`, () => !gone);
    }
    return r.token;
  };
  const fail = (err: unknown) => said.set(errorText(err));
  hold().catch(fail);
  const back = () => {
    if (!document.hidden) hold().catch(() => {});
  };
  document.addEventListener("visibilitychange", back);
  const every = setInterval(back, 5 * 60_000);
  onCleanup(() => {
    gone = true;
    document.removeEventListener("visibilitychange", back);
    clearInterval(every);
    if (handToken(location.hash)) history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  });
  const android = app?.platform === "android";
  const open = () => {
    if (offer.peek()) location.assign(outsideLink(location.href));
    else hold().then(() => location.assign(outsideLink(location.href)), fail);
  };
  // Where no menu says it (an app that has none), the address to copy by hand into the phone's browser. A link copied
  // goes wherever a paste can: every browser that opens it is asked for the number (account.CopiedHandoff).
  const copy = () => {
    const at = () => `${location.origin}/${location.hash}`;
    const token = offer.peek()?.token;
    if (token) api("POST", "/api/auth/handoff/copied", { token }).catch(() => {});
    let done: Promise<void>;
    try {
      done = navigator.clipboard.writeText(at());
    } catch (err) {
      done = Promise.reject(err);
    }
    done.then(
      () => said.set("Копирано. Отвори Safari и постави връзката в адресното поле."),
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
    android
      ? h("button", { class: "btn primary", type: "button", onclick: open }, "Отвори в браузъра")
      : h("p", { class: "exit-menu" }, h("b", null, menuWay())),
    () => {
      const o = offer();
      return o ? h("p", { class: "small exit-number" }, `Ако браузърът поиска число, въведи ${o.number}.`) : null;
    },
    h(
      "div",
      { class: "remind-actions" },
      android ? null : h("button", { class: "link tap", type: "button", onclick: copy }, "Копирай връзката"),
      app?.forms
        ? h("button", { class: "link tap", type: "button", onclick: () => keeping.set(true) }, "Или я запази с имейл")
        : null,
    ),
    () =>
      keeping()
        ? signIn({ form: "exit-keep", primary: false, note: keepNote, enter: "Потвърди", done: (s) => said.set(s) })
        : null,
    () => said() && h("p", { class: "muted keep-said", role: "status" }, said()),
  );
}

/** The cover's one small line in an app's own browser, under „Започни“: a game kept in the phone's browser is there.
 * On Android a tap opens it; on an iPhone the tap names the app's menu. */
export function coverExit(): Child {
  if (!app) return null;
  const named = signal(false);
  const go = () => {
    if (app?.platform === "android") location.assign(outsideLink(`${location.origin}/`));
    else named.set(true);
  };
  return h(
    "p",
    { class: "small issue-exit" },
    "Имаш игра в браузъра? ",
    h("button", { class: "link", type: "button", onclick: go }, "Отвори я там"),
    () => (named() ? h("b", null, ` ${menuWay()}`) : null),
  );
}

/** Whether a game was brought to this browser by a Handoff on this visit (takeHand): Днес's result then asks first
 * to keep it and be reminded (screens/today.ts). */
export const handedIn = signal(false);

/** The game a handoff's link brings (account.Handing): whose, on how many days it was played, whether the number
 * its page shows is asked for here, and whether this is the browser that made it. */
interface Handing {
  name: string;
  days: number;
  number?: boolean;
  mine?: boolean;
}

/** A game brought by a Handoff's token found in Днес's address (handToken, which Днес takes out of it at once):
 * taken here with one tap that names the game, or with the number the app's page shows where it's asked for; then
 * `done` draws Днес as it is, the day's result with the ask to keep the game and be reminded, and the notice says what
 * came of it. The app's browser it came from stays signed in (account.TakeHandoff). Opened where it was made, nothing
 * changes and nothing is asked. */
export function takeHand(token: string, done: () => void): Child {
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  const finish = (words: string) => {
    if (words) notice.set(words);
    done();
  };
  const take = async (number = 0) => {
    const before = user.peek();
    const r = await api<{ user: User }>("POST", "/api/auth/hand", { token, number });
    const same = before?.id === r.user.id;
    user.set(r.user);
    if (!same) handedIn.set(true);
    finish(same ? "" : "Готово: играта ти е тук.");
  };
  api<{ game: Handing }>("POST", "/api/auth/hand/look", { token }).then(
    (r) =>
      r.game.mine
        ? take().catch((err) => finish(errorText(err)))
        : screen.show(() => (r.game.number ? numberForm(r.game, take, finish) : confirmTake(r.game, take, finish))),
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
      class: "stack hand-number",
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
    h("button", { class: "link tap", type: "button", onclick: () => finish("") }, "Откажи"),
  );
}

/** The number the app's page shows, asked for in a browser that isn't plainly the same phone (account.Origin): a
 * link that reached someone else is no way into the game without it. A wrong one says the tries left; the last one
 * spent, the link is dead and Днес says so (`finish`). */
function numberForm(game: Handing, take: (n: number) => Promise<void>, finish: (words: string) => void): Child {
  const value = signal("");
  const error = signal("");
  const busy = signal(false);
  return h(
    "form",
    {
      class: "stack hand-number",
      onsubmit: async (e: SubmitEvent) => {
        e.preventDefault();
        if (value.peek().length !== 2) return error.set("Числото е от 2 цифри.");
        busy.set(true);
        error.set("");
        try {
          await take(Number(value.peek()));
        } catch (err) {
          if ((err as ApiError).code === "no_handoff") return finish(errorText(err));
          error.set(errorText(err));
        } finally {
          busy.set(false);
        }
      },
    },
    h("div", { class: "intro" }, h("h1", null, "Продължи играта тук")),
    h(
      "p",
      { class: "lead" },
      "Играта на ",
      h("strong", null, game.name),
      " идва от друго място. Въведи числото, което виждаш там, под играта.",
    ),
    h(
      "label",
      { class: "field" },
      h("span", null, "Число"),
      h("input", {
        class: "code",
        inputmode: "numeric",
        autocomplete: "off",
        value,
        oninput: (e: Event) => {
          const el = e.target as HTMLInputElement;
          el.value = el.value.replace(/\D/g, "").slice(0, 2);
          value.set(el.value);
        },
        ref: (el) => queueMicrotask(() => (el as HTMLInputElement).focus()),
      }),
    ),
    h("button", { class: "btn primary", disabled: busy }, "Продължи тук"),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
    h("button", { class: "link tap", type: "button", onclick: () => finish("") }, "Откажи"),
  );
}
