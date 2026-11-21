// Signing in by email, with a code: in Настройки, on Начало (a guest who keeps coming back, a player with a profile
// before a first game, the reminder by mail), on Профил, and wherever a game asks for a profile (a duel with a
// friend). The same code keeps a guest's game with the email, or signs in to the profile the email has (which the
// guest's game here then joins): what came of it is said (lib/keep.ts, keptWords) to `done`.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal, when } from "../lib/dom.ts";
import { embedded } from "../lib/embedded.ts";
import { keptWords } from "../lib/keep.ts";
import { pushable, pushOn } from "../lib/push.ts";
import { type User, user } from "../state.ts";

export interface SignInOptions {
  /** Its first button gold (Настройки), or plain (Начало, a card's). */
  primary?: boolean;
  /** The first button's words, which send the code: „Прати ми код“ unless said. */
  send?: string;
  /** The line under the first step: what the code is for. */
  note?: string;
  /** The button that takes the code: „Влез“ unless said („Потвърди“ where a guest keeps their game). */
  enter?: string;
  /** The address, filled in (a mail's link: server/streakmail.go, mailWho). */
  email?: string;
  /** The code taken: what came of it in words (keptWords), and the player now, told before the player is set, so that
   * what draws the screen anew as they are can say it. */
  done?: (said: string, now: User) => void;
}

/** Signing in by email, with a code (SignInOptions). Never in Meta's or TikTok's own browsers (lib/embedded.ts,
 * forms): what's typed there the app can read, so the way is the phone's own browser. */
export function signIn({
  primary = true,
  send: sendWords = "Прати ми код",
  note = "Без пароли: всеки път ти пращаме код за вход.",
  enter = "Влез",
  done,
  email: filled = "",
}: SignInOptions = {}): Child {
  if (embedded && !embedded.forms)
    return h(
      "p",
      { class: "muted" },
      "Тук не може да се влиза с имейл. Отвори играта в браузъра на телефона и я запази там.",
    );
  // A code sent from this form a little while ago, in this tab: a reload comes back to the step that takes it.
  const was = sentBefore(enter);
  const email = signal(was?.email ?? filled);
  const code = signal("");
  const sent = signal(!!was);
  // How long the code sent is: the server says (account.CodeDigits, or LongCodeDigits).
  const digits = signal(was?.digits ?? 6);
  const busy = signal(false);
  const error = signal("");
  // The code sent can't be used any more (its tries used up, or its time): a new one is the way on.
  const dead = signal(false);
  // The seconds until another code may go (account.CodeEvery), counted down beside „прати нов код“.
  const wait = signal(0);
  let ticking: ReturnType<typeof setInterval> | undefined;
  const countDown = (seconds: number) => {
    clearInterval(ticking);
    const until = Date.now() + seconds * 1000;
    const tick = () => {
      wait.set(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
      if (!wait.peek()) clearInterval(ticking);
    };
    tick();
    ticking = setInterval(tick, 1000);
  };
  onCleanup(() => clearInterval(ticking));
  if (was) countDown(Math.max(0, Math.ceil((was.again - Date.now()) / 1000)));

  const run = async (fn: () => Promise<void>) => {
    busy.set(true);
    error.set("");
    try {
      await fn();
    } catch (err) {
      const e = err as ApiError;
      error.set(e.message);
      if (e.code === "code_tries" || e.code === "code_expired") dead.set(true);
    } finally {
      busy.set(false);
    }
  };
  const send = () =>
    run(async () => {
      const r = await api<{ again?: number; digits?: number }>("POST", "/api/auth/code", { email: email.peek() });
      countDown(r.again ?? 60);
      digits.set(r.digits ?? 6);
      code.set("");
      dead.set(false);
      sent.set(true);
      keepSent({
        email: email.peek(),
        digits: digits.peek(),
        at: Date.now(),
        again: Date.now() + (r.again ?? 60) * 1000,
        enter,
      });
    });

  const errorLine = () => error() && h("p", { class: "bad", role: "alert" }, error());
  // What's missing, said the game's way in the error line (not the browser's bubble), and the field it's about.
  const missing = (words: string, field?: HTMLInputElement) => {
    error.set(words);
    field?.focus();
  };
  let codeField: HTMLInputElement | undefined;
  let emailField: HTMLInputElement | undefined;

  return when(
    () => sent(),
    () =>
      h(
        "form",
        {
          class: "stack",
          onsubmit: (e: SubmitEvent) => {
            e.preventDefault();
            if (code.peek().length !== digits.peek()) return missing(`Кодът е от ${digits.peek()} цифри.`, codeField);
            run(async () => {
              const r = await api<{ user: User }>("POST", "/api/auth/verify", {
                email: email.peek(),
                code: code.peek(),
              });
              keepSent(null);
              done?.(keptWords(user.peek(), r.user), r.user);
              user.set(r.user);
              // The browser has a new session, and its notifications went along with it (account.Verify); any it
              // turned on before they were kept with a session are told again, to be kept with this one.
              if (pushable()) pushOn().catch(() => {});
            });
          },
        },
        h("p", null, "Пратихме код на ", h("strong", null, email.peek()), ". Въведи го тук:"),
        h(
          "label",
          { class: "field" },
          h("span", null, "Код"),
          h("input", {
            // A long code (past many wrong ones for the address: account.LongCodeDigits) in a smaller hand, to fit.
            class: () => (digits() > 6 ? "code long" : "code"),
            inputmode: "numeric",
            autocomplete: "one-time-code",
            value: code,
            // Only the digits, however it was typed or pasted (a long code comes in fours, with spaces).
            oninput: (e: Event) => {
              const el = e.target as HTMLInputElement;
              el.value = el.value.replace(/\D/g, "").slice(0, digits.peek());
              code.set(el.value);
            },
            ref: (el) => {
              codeField = el as HTMLInputElement;
              queueMicrotask(() => el.focus());
            },
          }),
        ),
        // A dead code takes no more tries: the way on is a new one, at once.
        () =>
          dead()
            ? h("button", { type: "button", class: "btn primary", onclick: send, disabled: busy }, "Прати нов код")
            : h("button", { class: "btn primary", disabled: busy }, enter),
        errorLine,
        h(
          "p",
          { class: "muted" },
          () =>
            dead()
              ? null
              : [
                  "Няма го? Виж в папката за спам или ",
                  h(
                    "button",
                    { type: "button", class: "link", onclick: send, disabled: () => busy() || wait() > 0 },
                    "поискай нов код",
                  ),
                  () => (wait() ? ` след ${wait()}\u00a0с` : ""),
                  ". ",
                ],
          h(
            "button",
            {
              type: "button",
              class: "link",
              onclick: () => {
                keepSent(null);
                sent.set(false);
              },
            },
            "Смени имейла",
          ),
        ),
      ),
    () =>
      h(
        "form",
        {
          class: "stack",
          onsubmit: (e: SubmitEvent) => {
            e.preventDefault();
            if (!email.peek().trim()) return missing("Напиши имейла си.", emailField);
            send();
          },
        },
        h(
          "label",
          { class: "field" },
          h("span", null, "Имейл"),
          h("input", {
            type: "email",
            autocomplete: "email",
            value: email.peek(),
            oninput: (e: Event) => {
              email.set((e.target as HTMLInputElement).value);
              error.set("");
            },
            ref: (el) => {
              emailField = el as HTMLInputElement;
            },
          }),
        ),
        h("button", { class: primary ? "btn primary" : "btn", disabled: busy }, sendWords),
        errorLine,
        h("p", { class: "muted" }, note),
      ),
  );
}

/** A code sent, as this tab keeps it (sessionStorage) so that a reload comes back to the step that takes it: the
 * address, the code's length, when it went and when another may, and the form's own words (`enter`: which form it
 * was, of those on a page). */
interface Sent {
  email: string;
  digits: number;
  at: number;
  again: number;
  enter: string;
}

const sentKey = "almanac.signin";

/** How long a code sent is taken back to after a reload: inside its own life (account.CodeTTL, fifteen minutes). */
const sentFor = 14 * 60_000;

/** The code this form (`enter`) sent a little while ago in this tab, if any. */
function sentBefore(enter: string): Sent | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(sentKey) ?? "null") as Sent | null;
    return s && s.enter === enter && typeof s.email === "string" && Date.now() - s.at < sentFor ? s : null;
  } catch {
    return null; // no storage: the form starts at the address
  }
}

/** Keeps the code sent (or, with null, forgets it: taken, or another address). */
function keepSent(s: Sent | null): void {
  try {
    if (s) sessionStorage.setItem(sentKey, JSON.stringify(s));
    else sessionStorage.removeItem(sentKey);
  } catch {
    // not kept: a reload starts at the address
  }
}
