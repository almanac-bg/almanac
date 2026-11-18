// Signing in by email, with a code: in Настройки, on Начало (a guest who keeps coming back, a player with a profile
// before a first game, the reminder by mail), on Профил, and wherever a game asks for a profile (a duel with a
// friend). The same code keeps a guest's game with the email, or signs in to the profile the email has (which the
// guest's game here then joins): what came of it is said (lib/keep.ts, keptWords) to `done`.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal, when } from "../lib/dom.ts";
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
  /** The code taken: what came of it in words (keptWords), and the player now, told before the player is set, so that
   * what draws the screen anew as they are can say it. */
  done?: (said: string, now: User) => void;
}

/** Signing in by email, with a code (SignInOptions). */
export function signIn({
  primary = true,
  send: sendWords = "Прати ми код",
  note = "Без пароли: всеки път ти пращаме код за вход.",
  enter = "Влез",
  done,
}: SignInOptions = {}): Child {
  const email = signal("");
  const code = signal("");
  const sent = signal(false);
  // How long the code sent is: the server says (account.CodeDigits, or LongCodeDigits).
  const digits = signal(6);
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
    });

  const errorLine = () => error() && h("p", { class: "bad", role: "alert" }, error());

  return when(
    () => sent(),
    () =>
      h(
        "form",
        {
          class: "stack",
          onsubmit: (e: SubmitEvent) => {
            e.preventDefault();
            run(async () => {
              const r = await api<{ user: User }>("POST", "/api/auth/verify", {
                email: email.peek(),
                code: code.peek(),
              });
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
            pattern: () => `[0-9]{${digits()}}`,
            required: true,
            value: code,
            // Only the digits, however it was typed or pasted (a long code comes in fours, with spaces).
            oninput: (e: Event) => {
              const el = e.target as HTMLInputElement;
              el.value = el.value.replace(/\D/g, "").slice(0, digits.peek());
              code.set(el.value);
            },
            ref: (el) => queueMicrotask(() => el.focus()),
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
                  "Няма го? Виж в спама или ",
                  h(
                    "button",
                    { type: "button", class: "link", onclick: send, disabled: () => busy() || wait() > 0 },
                    "прати нов код",
                  ),
                  () => (wait() ? ` след ${wait()} с` : ""),
                  ". ",
                ],
          h("button", { type: "button", class: "link", onclick: () => sent.set(false) }, "Смени имейла"),
        ),
      ),
    () =>
      h(
        "form",
        {
          class: "stack",
          onsubmit: (e: SubmitEvent) => {
            e.preventDefault();
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
            required: true,
            value: email.peek(),
            oninput: (e: Event) => email.set((e.target as HTMLInputElement).value),
          }),
        ),
        h("button", { class: primary ? "btn primary" : "btn", disabled: busy }, sendWords),
        errorLine,
        h("p", { class: "muted" }, note),
      ),
  );
}
