// Настройки: the name and tag (saved as they're left), the account and its email, reminders, and the data the game
// keeps; and this device's sound and access, with a profile or without one.

import type { Kit } from "../kit.ts";
import type { Child, Signal } from "../lib/dom.ts";
import type { PushKind, PushPrefs } from "../lib/push.ts";
import type { User } from "../state.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  api,
  errorText,
  inApp,
  computed,
  effect,
  h,
  onCleanup,
  signal,
  untracked,
  when,
  reportProblem,
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
  needsHomeScreen,
  pushable,
  pushOn,
  pushPrefs,
  setPushPref,
  turnOff,
  turnOn,
  go,
  title,
  quietWhenSilent,
  setSound,
  soundOn,
  notice,
  user,
  back,
  signIn,
} = {} as Kit;

/** Signed out just now: said here, where it was done, and only here (Начало, next, doesn't say it again). */
let signedOut: Signal<boolean>;

export function settings(kit: Kit) {
  ({
    api,
    errorText,
    inApp,
    computed,
    effect,
    h,
    onCleanup,
    signal,
    untracked,
    when,
    reportProblem,
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
    needsHomeScreen,
    pushable,
    pushOn,
    pushPrefs,
    setPushPref,
    turnOff,
    turnOn,
    go,
    title,
    quietWhenSilent,
    setSound,
    soundOn,
    notice,
    user,
    back,
    signIn,
  } = kit);
  title("Настройки");
  notice.set("");
  signedOut = signal(false);
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
                    "Излезе от профила си. Влез пак с имейла си или започни да играеш.",
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
      note.set({ text: errorText(err), bad: true });
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
        autocomplete: "nickname",
        minlength: 2,
        maxlength: 30,
        required: true,
        value: name,
        oninput: (e: Event) => name.set((e.target as HTMLInputElement).value),
      }),
      // Seen by everyone (the boards, Роял, a link's preview): no more than a player means to show.
      h("small", { class: "muted", id: "name-how" }, "Вижда се от всички в играта. Прякор или малкото ти име стигат."),
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
        signOutOthers(),
      ],
      () => [
        h("h2", null, "Влез или запази профила си"),
        h(
          "p",
          { class: "muted" },
          "Засега играта ти се пази само на това устройство. Добави имейл и ще я имаш навсякъде, където влезеш с него. Имаш профил от друго устройство? Влез с неговия имейл и играта оттук ще се добави към профила.",
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
        ? "Важи за това устройство. Когато телефонът е в безшумен режим, звуците мълчат."
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
            "Имейл, когато серията ти прекъсне",
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
                error.set(errorText(err));
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
          error.set(errorText(err));
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
                        "Покани за приятелство, предизвикателства, как са свършили игрите ти, краят на седмицата в лигата.",
                      ),
                      kind("royal", "Роял", "Когато входът се отвори: в 20:45 в дните на Роял."),
                    )
                  : null,
              // The night's quiet (server/pushes.go): what's due then comes at 8:00.
              h("p", { class: "muted" }, "Нощем, от 22:00 до 8:00, не идват известия."),
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
          h("p", null, "Профилът, името и всички игри ще се изтрият завинаги."),
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
                  error.set(errorText(err));
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
  // This browser's notifications were the account's: they stop with it. The server forgets them with the session
  // (account.SignOut); the browser lets go of its subscription here.
  if (pushable()) await turnOff().catch(() => {});
  await api("POST", "/api/auth/signout", {}).catch(() => {});
  signedOut.set(true);
  user.set(null);
}

/** Signing out of the profile everywhere else (a phone lost, a computer left signed in): this device stays in. */
function signOutOthers(): Child {
  const said = signal("");
  const bad = signal(false);
  const busy = signal(false);
  const run = async () => {
    busy.set(true);
    try {
      await api("POST", "/api/auth/signout-others", {});
      bad.set(false);
      said.set("Готово: профилът ти е отворен само на това устройство.");
      // Notifications turned on here before they were kept with this session ended with the others: told again,
      // they're kept (push.ts).
      if (pushable()) pushOn().catch(() => {});
    } catch (err) {
      bad.set(true);
      said.set(errorText(err));
    } finally {
      busy.set(false);
    }
  };
  return [
    h("button", { class: "link", onclick: run, disabled: busy }, "Излез от другите устройства"),
    () => said() && h("p", { class: bad() ? "bad" : "muted", role: "status" }, said()),
  ];
}
