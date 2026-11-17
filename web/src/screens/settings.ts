// Настройки: the name and tag (saved as they're left), the account and its email, reminders, and the data the game
// keeps; and this device's sound and access, with a profile or without one.

import { type ApiError, api } from "../lib/api.ts";
import { inApp } from "../lib/app.ts";
import { type Child, computed, effect, h, onCleanup, signal, untracked, when } from "../lib/dom.ts";
import { reportProblem } from "../lib/errors.ts";
import {
  bigText,
  calm,
  musicOn,
  setBigText,
  setCalm,
  setMusic,
  setTick,
  setVibrate,
  tickOn,
  vibrateOn,
} from "../lib/prefs.ts";
import {
  needsHomeScreen,
  type PushKind,
  type PushPrefs,
  pushable,
  pushOn,
  pushPrefs,
  setPushPref,
  turnOff,
  turnOn,
} from "../lib/push.ts";
import { go, title } from "../lib/router.ts";
import { quietWhenSilent, setSound, soundOn } from "../lib/sound.ts";
import { type User, user } from "../state.ts";
import { back } from "../ui.ts";

/** What became of the profile just now, said once where the player lands, on Начало: deleted, or a game brought from
 * another browser. */
export const notice = signal("");

/** Signed out just now: said here, where it was done, and only here (Начало, next, doesn't say it again). */
const signedOut = signal(false);

export function settings() {
  title("Настройки");
  notice.set("");
  signedOut.set(false);
  return h(
    "section",
    { class: "screen" },
    h("div", { class: "intro" }, () => (user() ? back("/me", "Профил") : null), h("h1", null, "Настройки")),
    // What's this device's (sounds, less motion) is there with a profile or without one.
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
            h("p", null, h("a", { class: "link", href: "/privacy" }, "Какво пазим и защо")),
            deleteAccount(),
          ),
        ),
      () =>
        h(
          "div",
          { class: "settings" },
          h(
            "section",
            { class: "stack" },
            () =>
              signedOut()
                ? h(
                    "p",
                    { class: "lead", role: "status" },
                    "Излезе от профила. Влез пак с имейла си или започни да играеш.",
                  )
                : h("p", { class: "lead" }, "Още нямаш профил. Влез с имейл или започни да играеш."),
            signIn(),
          ),
          sounds(),
          access(),
        ),
    ),
  );
}

function nameForm(): Child {
  const name = signal("");
  const tag = signal("");
  // The account's, and again when it's another (a guest who signs in to the account they had): never the last one's.
  const id = computed(() => user()?.id);
  effect(() => {
    id();
    untracked(() => {
      name.set(user()?.name ?? "");
      tag.set(user()?.tag ?? "");
    });
  });
  const busy = signal(false);
  const note = signal<{ text: string; bad?: boolean } | null>(null);
  let form: HTMLFormElement | null = null;
  // A name or tag changed and not saved yet, that would be taken as it is (the fields' own rules hold).
  const unsaved = () => {
    const u = user.peek();
    return !!u && !!form?.checkValidity() && (name.peek().trim() !== u.name || tag.peek().trim() !== u.tag);
  };
  const save = async () => {
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
  };
  // Saved as a field is left, and as the screen is: a name changed is never dropped by going elsewhere.
  const saveIfChanged = () => {
    if (!busy.peek() && unsaved()) save();
  };
  onCleanup(saveIfChanged);
  return h(
    "form",
    {
      class: "stack",
      ref: (el) => {
        form = el as HTMLFormElement;
      },
      onsubmit: (e: SubmitEvent) => {
        e.preventDefault();
        if (!busy.peek()) save();
      },
      onfocusout: (e: FocusEvent) => {
        // Not while moving between the form's own fields and its button.
        if (!form?.contains(e.relatedTarget as Node | null)) saveIfChanged();
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
      h("span", null, "Потребителско име"),
      h(
        "span",
        { class: "tag-input" },
        h("span", { "aria-hidden": "true" }, "@"),
        h("input", {
          name: "tag",
          "aria-label": "Потребителско име",
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
        "Само твое: по него приятелите те намират. Латински букви, цифри и _.",
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
        h("button", { class: "link", onclick: signOut }, "Излез"),
      ],
      () => [
        h("h2", null, "Влез или запази профила си"),
        h(
          "p",
          { class: "muted" },
          "Сега играта ти се пази само на това устройство. Добави имейл и ще я имаш навсякъде, където влезеш с него. Имаш профил от друго устройство? Влез с имейла му и играта оттук ще се добави към него.",
        ),
        signIn(),
      ],
    ),
  );
}

/** A setting kept on this device: its name, what it does, and a switch. */
function switchRow(label: string, about: string, on: () => boolean, set: (v: boolean) => void): Child {
  return h(
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
}

/** Sounds, the clock's last seconds among them, and in the app the phone's touch: on or off, on this device. */
function sounds(): Child {
  return h(
    "section",
    null,
    h("h2", null, "Звук"),
    h(
      "p",
      { class: "muted" },
      quietWhenSilent()
        ? "Важи за това устройство. Когато телефонът е на тих режим, звуците мълчат."
        : "Важи за това устройство.",
    ),
    switchRow("Звуци", "Часовникът, отговорите, новото ниво.", soundOn, setSound),
    switchRow("Тиктакане", "Последните секунди на въпроса.", tickOn, setTick),
    switchRow("Музика в Роял", "Тиха музика, докато чакаш началото.", musicOn, setMusic),
    // The phone's touch: only in the app, where it's felt.
    inApp ? switchRow("Вибрация", "При отговорите и наградите.", vibrateOn, setVibrate) : null,
  );
}

/** Достъпност: less motion and bigger text, for this device. */
function access(): Child {
  return h(
    "section",
    null,
    h("h2", null, "Достъпност"),
    h("p", { class: "muted" }, "Важи за това устройство."),
    switchRow("По-малко движение", "Без анимации; часовникът пак тече.", calm, setCalm),
    switchRow("По-едър текст", "Всичко малко по-голямо.", bigText, setBigText),
  );
}

/** The mail when a streak ends (server/streakmail.go): a switch, for a player with an email whom no notification
 * reaches, on any device. */
function byMail() {
  const prefs = signal<{ streak: boolean; can: boolean } | null>(null);
  const error = signal("");
  const load = () => {
    if (user.peek()?.email) api<{ streak: boolean; can: boolean }>("GET", "/api/mail/prefs").then(prefs.set, () => {});
    else prefs.set(null);
  };
  // Again as an email is added (a guest signing in here), or the player signs out.
  effect(() => {
    user()?.email;
    untracked(load);
  });
  const row = () =>
    prefs()?.can
      ? [
          switchRow(
            "По имейл, когато серията ми прекъсне",
            "Едно писмо, ако серия от 5 дни или повече прекъсне. Най-много едно на 30 дни.",
            () => prefs()?.streak ?? false,
            async (on) => {
              const was = prefs.peek();
              if (!was) return;
              error.set("");
              prefs.set({ ...was, streak: on });
              try {
                prefs.set(await api("PATCH", "/api/mail/prefs", { kind: "streak", on }));
              } catch (err) {
                prefs.set(was);
                error.set((err as ApiError).message);
              }
            },
          ),
          () => error() && h("p", { class: "bad", role: "alert" }, error()),
        ]
      : null;
  return { row, load, can: () => !!prefs()?.can };
}

/** Notifications: on or off on this device, and which kinds the player gets (on every device they have them on); and
 * for whom no notification reaches, the mail when a streak ends. */
function reminders(): Child {
  const mail = byMail();
  if (needsHomeScreen()) {
    return h(
      "section",
      { class: "stack" },
      h("h2", null, "Известия"),
      h(
        "p",
        { class: "muted" },
        "На iPhone известията идват, щом добавиш АЛМАНАХ към началния екран: Сподели → Добави към началния екран. После ги включи оттук.",
      ),
      mail.row,
    );
  }
  if (!pushable())
    return () => (mail.can() ? h("section", { class: "stack" }, h("h2", null, "Известия"), mail.row) : null);
  const on = signal<boolean | null>(null);
  const prefs = signal<PushPrefs | null>(null);
  const error = signal("");
  const load = () => pushPrefs().then(prefs.set, () => {});
  pushOn().then(
    (v) => {
      on.set(v);
      if (v) load();
    },
    () => on.set(false),
  );
  const toggle = async () => {
    error.set("");
    try {
      if (on.peek()) {
        await turnOff();
        on.set(false);
      } else {
        const why = await turnOn();
        if (why) error.set(why);
        else {
          on.set(true);
          load();
        }
      }
      mail.load(); // notifications on a device take the mail's place, and off give it back
    } catch (err) {
      reportProblem(`reminders: ${(err as Error).name}: ${(err as Error).message}`);
      error.set("Не успяхме. Опитай пак.");
    }
  };
  const kind = (k: PushKind, label: string, about: string) =>
    switchRow(
      label,
      about,
      () => prefs()?.[k] ?? false,
      async (v) => {
        const was = prefs.peek();
        if (!was) return;
        error.set("");
        prefs.set({ ...was, [k]: v });
        try {
          prefs.set(await setPushPref(k, v));
        } catch (err) {
          prefs.set(was);
          error.set((err as ApiError).message);
        }
      },
    );
  return h(
    "section",
    { class: "stack" },
    h("h2", null, "Известия"),
    () =>
      on() === null
        ? null
        : on()
          ? [
              h("p", { class: "muted" }, "Включени на това устройство. Избери за какво:"),
              () =>
                prefs()
                  ? h(
                      "div",
                      null,
                      kind("day", "Въпросите на деня", "Веднъж на ден, около часа, в който играеш, ако още те чакат."),
                      kind(
                        "friends",
                        "Приятели и дуели",
                        "Покани, дуели, как са свършили игрите ти, краят на седмицата в лигата.",
                      ),
                      kind("royal", "Роял", "Когато входът се отвори: в 20:45 в дните на Роял."),
                    )
                  : null,
              h("button", { class: "link", onclick: toggle }, "Спри известията тук"),
            ]
          : [
              h("p", { class: "muted" }, "Въпросите на деня, приятели, дуели, Роял: ти избираш за какво."),
              h("button", { class: "btn", onclick: toggle }, "Включи известията"),
            ],
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
    mail.row,
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
                  // Nothing is left here: Начало, as for someone new, says so once.
                  notice.set("Профилът е изтрит.");
                  user.set(null);
                  go("/", true);
                } catch (err) {
                  error.set((err as ApiError).message);
                }
              },
            },
            "Изтрий профила",
          ),
          h("button", { class: "link tap", onclick: () => asking.set(false) }, "Откажи"),
          error() && h("p", { class: "bad", role: "alert" }, error()),
        )
      : h("button", { class: "link tap", onclick: () => asking.set(true) }, "Изтрий профила");
}

async function signOut() {
  // This browser's notifications were the account's: they stop with it (while signed in, so the server forgets them).
  if (pushable()) await turnOff().catch(() => {});
  await api("POST", "/api/auth/signout", {}).catch(() => {});
  signedOut.set(true);
  user.set(null);
}

/** Signing in by email, with a code: in Настройки, and on Начало (a guest who keeps coming back, a player with a
 * profile before a first game, where its button is a plain one: `primary` false). */
export function signIn(primary = true): Child {
  const email = signal("");
  const code = signal("");
  const sent = signal(false);
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
      const r = await api<{ again?: number }>("POST", "/api/auth/code", { email: email.peek() });
      countDown(r.again ?? 60);
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
            value: code,
            oninput: (e: Event) => code.set((e.target as HTMLInputElement).value.replace(/\D/g, "")),
            ref: (el) => queueMicrotask(() => el.focus()),
          }),
        ),
        // A dead code takes no more tries: the way on is a new one, at once.
        () =>
          dead()
            ? h("button", { type: "button", class: "btn primary", onclick: send, disabled: busy }, "Прати нов код")
            : h("button", { class: "btn primary", disabled: busy }, "Влез"),
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
        h("button", { class: primary ? "btn primary" : "btn", disabled: busy }, "Прати ми код"),
        errorLine,
        h("p", { class: "muted" }, "Без пароли: всеки път ти пращаме код за вход."),
      ),
  );
}
