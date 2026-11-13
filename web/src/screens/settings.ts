// Настройки: the name and tag, the account and its email, sounds and reminders, and the data the game keeps.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal, when } from "../lib/dom.ts";
import { reportProblem } from "../lib/errors.ts";
import { bigText, calm, setBigText, setCalm, setTick, tickOn } from "../lib/prefs.ts";
import { needsHomeScreen, pushable, pushOn, turnOff, turnOn } from "../lib/push.ts";
import { title } from "../lib/router.ts";
import { setSound, soundOn } from "../lib/sound.ts";
import { type User, user } from "../state.ts";

export function settings() {
  title("Настройки");
  return h(
    "section",
    { class: "screen" },
    h("h1", null, "Настройки"),
    when(
      () => user(),
      () =>
        h(
          "div",
          { class: "settings" },
          nameForm(),
          sounds(),
          access(),
          reminders(),
          account(),
          h(
            "section",
            null,
            h("h2", null, "Данните ти"),
            h("p", null, h("a", { href: "/privacy" }, "Какво пазим и защо")),
            deleteAccount(),
          ),
        ),
      () => [h("p", { class: "lead" }, "Още нямаш профил. Влез с имейл или започни да играеш."), signIn()],
    ),
  );
}

function nameForm(): Child {
  const name = signal(user.peek()?.name ?? "");
  const tag = signal(user.peek()?.tag ?? "");
  const busy = signal(false);
  const note = signal<{ text: string; bad?: boolean } | null>(null);
  return h(
    "form",
    {
      class: "stack",
      onsubmit: async (e: SubmitEvent) => {
        e.preventDefault();
        busy.set(true);
        note.set(null);
        try {
          const r = await api<{ user: User }>("PATCH", "/api/me", { name: name.peek(), tag: tag.peek() });
          user.set(r.user);
          name.set(r.user.name);
          tag.set(r.user.tag);
          note.set({ text: "Запазено." });
        } catch (err) {
          note.set({ text: (err as ApiError).message, bad: true });
        } finally {
          busy.set(false);
        }
      },
    },
    h(
      "label",
      { class: "field" },
      h("span", null, "Име"),
      h("input", {
        name: "name",
        "aria-label": "Име",
        "aria-describedby": "name-how",
        autocomplete: "name",
        minlength: 2,
        maxlength: 30,
        required: true,
        value: name,
        oninput: (e: Event) => name.set((e.target as HTMLInputElement).value),
      }),
      h("small", { class: "muted", id: "name-how" }, "Както искаш да те виждат — може и истинското ти име."),
    ),
    h(
      "label",
      { class: "field" },
      h("span", null, "Таг"),
      h(
        "span",
        { class: "tag-input" },
        h("span", { "aria-hidden": "true" }, "@"),
        h("input", {
          name: "tag",
          "aria-label": "Таг",
          "aria-describedby": "tag-how",
          autocomplete: "username",
          autocapitalize: "none",
          spellcheck: false,
          minlength: 3,
          maxlength: 20,
          pattern: "@?[A-Za-z][A-Za-z0-9_]{2,19}",
          required: true,
          value: tag,
          oninput: (e: Event) => tag.set((e.target as HTMLInputElement).value),
        }),
      ),
      h(
        "small",
        { class: "muted", id: "tag-how" },
        "Само твой: по него приятелите те намират. Латински букви, цифри и _.",
      ),
    ),
    h("button", { class: "btn", disabled: busy }, "Запази"),
    () => {
      const n = note();
      return n && h("p", { class: n.bad ? "bad" : "muted", role: "status" }, n.text);
    },
  );
}

function account(): Child {
  return h(
    "section",
    { class: "stack" },
    when(
      () => user()?.email,
      () => [
        h("h2", null, "Профилът ти"),
        h(
          "p",
          null,
          "Влизаш с ",
          h("strong", null, () => user()?.email ?? ""),
          ".",
        ),
        h("button", { class: "link", onclick: signOut }, "Изход"),
      ],
      () => [
        h("h2", null, "Запази профила си"),
        h(
          "p",
          { class: "muted" },
          "Сега играта ти се пази само на това устройство. Добави имейл и ще я имаш навсякъде, където влезеш с него.",
        ),
        signIn(),
      ],
    ),
  );
}

/** Sounds: on or off, on this device. */
function sounds(): Child {
  return h(
    "section",
    null,
    h("h2", null, "Звуци"),
    h("p", { class: "muted" }, "Кратки звуци: часовникът, отговорите, новото ниво. Важи за това устройство."),
    h("button", { class: "btn", type: "button", onclick: () => setSound(!soundOn.peek()) }, () =>
      soundOn() ? "Изключи звуците" : "Включи звуците",
    ),
  );
}

/** Достъпност: less motion, bigger text, the clock's ticking — for this device. */
function access(): Child {
  const row = (label: string, about: string, on: () => boolean, set: (v: boolean) => void) =>
    h(
      "div",
      { class: "switch-row" },
      h("span", { class: "switch-text" }, h("b", null, label), h("span", { class: "muted" }, about)),
      h(
        "button",
        {
          class: "switch",
          type: "button",
          role: "switch",
          "aria-checked": on,
          "aria-label": label,
          onclick: () => set(!on()),
        },
        h("span", { class: "switch-knob", "aria-hidden": "true" }),
      ),
    );
  return h(
    "section",
    null,
    h("h2", null, "Достъпност"),
    h("p", { class: "muted" }, "Важи за това устройство."),
    row("По-малко движение", "Без анимации; таймерът пак тече.", calm, setCalm),
    row("По-едър текст", "Всичко малко по-голямо.", bigText, setBigText),
    row("Тиктакане", "Часовникът, докато въпросът чака.", tickOn, setTick),
  );
}

/** Notifications: the evening reminder, and word when a friend accepts your link or calls you to a duel. */
function reminders(): Child {
  if (needsHomeScreen()) {
    return h(
      "section",
      { class: "stack" },
      h("h2", null, "Напомняния"),
      h(
        "p",
        { class: "muted" },
        "На iPhone известията идват, щом добавиш АЛМАНАХ към началния екран: Сподели → Добави към началния екран. После ги включи оттук.",
      ),
    );
  }
  if (!pushable()) return null;
  const on = signal<boolean | null>(null);
  const error = signal("");
  pushOn().then(on.set, () => on.set(false));
  const toggle = async () => {
    error.set("");
    try {
      if (on.peek()) {
        await turnOff();
        on.set(false);
      } else {
        const why = await turnOn();
        if (why) error.set(why);
        else on.set(true);
      }
    } catch (err) {
      reportProblem(`reminders: ${(err as Error).name}: ${(err as Error).message}`);
      error.set("Не успяхме. Опитай пак.");
    }
  };
  return h(
    "section",
    { class: "stack" },
    h("h2", null, "Напомняния"),
    h(
      "p",
      { class: "muted" },
      "Вечер в 19:00, ако въпросите на деня още те чакат, и когато приятел те покани на дуел.",
    ),
    () =>
      on() === null
        ? null
        : h("button", { class: on() ? "link" : "btn", onclick: toggle }, on() ? "Спри напомнянията" : "Напомняй ми"),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

/** Deleting the profile: everything goes, after a second, explicit yes. */
function deleteAccount(): Child {
  const asking = signal(false);
  const error = signal("");
  return () =>
    asking()
      ? h(
          "div",
          { class: "stack" },
          h("p", null, "Профилът, името и всички игри ще бъдат изтрити завинаги."),
          h(
            "button",
            {
              class: "btn danger",
              onclick: async () => {
                try {
                  await api("DELETE", "/api/me");
                  user.set(null);
                } catch (err) {
                  error.set((err as ApiError).message);
                }
              },
            },
            "Изтрий профила",
          ),
          h("button", { class: "link", onclick: () => asking.set(false) }, "Отказ"),
          error() && h("p", { class: "bad", role: "alert" }, error()),
        )
      : h("button", { class: "link", onclick: () => asking.set(true) }, "Изтрий профила");
}

async function signOut() {
  await api("POST", "/api/auth/signout", {}).catch(() => {});
  user.set(null);
}

/** Signing in with an email: the address, then the code mailed to it. */
function signIn(): Child {
  const email = signal("");
  const code = signal("");
  const sent = signal(false);
  const busy = signal(false);
  const error = signal("");

  const run = async (fn: () => Promise<void>) => {
    busy.set(true);
    error.set("");
    try {
      await fn();
    } catch (err) {
      error.set((err as ApiError).message);
    } finally {
      busy.set(false);
    }
  };
  const send = () =>
    run(async () => {
      await api("POST", "/api/auth/code", { email: email.peek() });
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
              user.set(r.user);
            });
          },
        },
        h("p", null, "Пратихме код на ", h("strong", null, email.peek()), ". Въведи го тук:"),
        h(
          "label",
          { class: "field" },
          h("span", null, "Код"),
          h("input", {
            class: "code",
            inputmode: "numeric",
            autocomplete: "one-time-code",
            pattern: "[0-9]{6}",
            maxlength: 6,
            required: true,
            oninput: (e: Event) => code.set((e.target as HTMLInputElement).value.replace(/\D/g, "")),
            ref: (el) => queueMicrotask(() => el.focus()),
          }),
        ),
        h("button", { class: "btn primary", disabled: busy }, "Влез"),
        errorLine,
        h(
          "p",
          { class: "muted" },
          "Няма го? Виж в спама или ",
          h("button", { type: "button", class: "link", onclick: send, disabled: busy }, "прати нов код"),
          ". ",
          h("button", { type: "button", class: "link", onclick: () => sent.set(false) }, "Друг имейл"),
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
        h("button", { class: "btn primary", disabled: busy }, "Прати ми код"),
        errorLine,
        h("p", { class: "muted" }, "Без пароли: всеки път ти пращаме код за вход."),
      ),
  );
}
