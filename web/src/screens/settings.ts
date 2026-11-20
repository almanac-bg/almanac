// Настройки: the name and tag (saved as they're left), the account and its email, reminders, and the data the game
// keeps; and this device's look (Night or Day), sound and access, with a profile or without one.

import type { Kit } from "../kit.ts";
import type { Child, Signal } from "../lib/dom.ts";
import type { PushKind, PushPrefs } from "../lib/push.ts";
import type { User } from "../state.ts";
import type { MailPrefs } from "./keep.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  api,
  errorText,
  computed,
  effect,
  h,
  onCleanup,
  signal,
  untracked,
  when,
  reportProblem,
  textSize,
  schemeSwitch,
  calm,
  musicOn,
  setTextSize,
  setCalm,
  setMusic,
  setTick,
  tickOn,
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
  mailAsk,
  segmented,
} = {} as Kit;

/** Signed out just now: said here, where it was done, and only here (Начало, next, doesn't say it again). */
let signedOut: Signal<boolean>;
/** What came of a code put in here just now (signIn: a game kept, a profile signed in to), said under the profile. */
let signedIn: Signal<string>;

export function settings(kit: Kit) {
  ({
    api,
    errorText,
    computed,
    effect,
    h,
    onCleanup,
    signal,
    untracked,
    when,
    reportProblem,
    textSize,
    schemeSwitch,
    calm,
    musicOn,
    setTextSize,
    setCalm,
    setMusic,
    setTick,
    tickOn,
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
    mailAsk,
    segmented,
  } = kit);
  title("Настройки");
  notice.set("");
  signedOut = signal(false);
  signedIn = signal("");
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
          reminders(),
          looks(),
          sounds(),
          access(),
          account(),
          h(
            "section",
            null,
            h("h2", null, "Данните ти"),
            h("p", null, h("a", { class: "link tap", href: "/privacy" }, "Какво пазим и защо")),
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
            signIn({ done: (said) => signedIn.set(said) }),
          ),
          looks(),
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
        // Come to change the name (Профил's „Смени го“ under a name drawn): the field, ready for the new one.
        ref: (el) => {
          if (location.hash === "#name")
            queueMicrotask(() => {
              (el as HTMLInputElement).focus();
              (el as HTMLInputElement).select();
            });
        },
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
        () => signedIn() && h("p", { class: "muted", role: "status" }, signedIn()),
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
        h("h2", null, "Запази играта си"),
        h(
          "p",
          { class: "muted" },
          "Засега играта ти се пази само на това устройство. Добави имейл и ще я имаш навсякъде, където влезеш с него. Имаш профил от друго устройство? Влез с неговия имейл и играта оттук ще се добави към профила.",
        ),
        signIn({ enter: "Потвърди", done: (said) => signedIn.set(said) }),
      ],
    ),
  );
}

let switches = 0;

/** A setting kept on this device: its name, what it does, and a switch. The whole row is the switch's to tap (a
 * label), not only its knob. */
function switchRow(label: string, about: string, on: () => boolean, set: (v: boolean) => void): Child {
  const said = `switch-about-${++switches}`;
  return h(
    "label",
    { class: "switch-row" },
    h("span", { class: "switch-text" }, h("b", null, label), h("span", { class: "muted", id: said }, about)),
    h(
      "button",
      {
        class: "switch",
        type: "button",
        role: "switch",
        "aria-checked": on,
        "aria-label": label,
        "aria-describedby": said,
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
  );
}

/** Изглед: Night or Day, for this device; as the device is set until chosen. */
function looks(): Child {
  return h(
    "section",
    null,
    h("h2", null, "Изглед"),
    h("p", { class: "muted" }, "Важи за това устройство."),
    schemeSwitch(),
  );
}

/** Достъпност: less motion and the text's size, for this device. */
function access(): Child {
  return h(
    "section",
    null,
    h("h2", null, "Достъпност"),
    h("p", { class: "muted" }, "Важи за това устройство."),
    switchRow("По-малко движение", "Без анимации; часовникът пак тече.", calm, setCalm),
    h(
      "div",
      { class: "text-size" },
      h(
        "span",
        { class: "switch-text", "aria-hidden": "true" },
        h("b", null, "Размер на текста"),
        h("span", { class: "muted" }, "„Обичаен“ е размерът от настройките на устройството."),
      ),
      segmented(
        "Размер на текста",
        [
          ["normal", "Обичаен"],
          ["big", "Едър"],
          ["bigger", "Много едър"],
        ],
        textSize,
        setTextSize,
        false,
        true,
      ),
    ),
  );
}

/** Mail for whom no notification reaches, on any device (a player with an email, proved by its code): the day's
 * reminder (server/daymail.go) and the mail when a streak ends (server/streakmail.go), a switch each. A guest where
 * notifications can't come here (`ask`) is offered the reminder by mail, which keeps their game with the email too
 * (mailAsk), which says what came of it above the switches once it's on. */
function byMail(ask: () => boolean) {
  type Prefs = MailPrefs;
  const prefs = signal<Prefs | null>(null);
  const error = signal("");
  // Each change here (a switch, the guest's ask turning the reminder on) makes the prefs asked for before it stale:
  // their answer, coming after, would put a switch back.
  let asked = 0;
  const now = (p: Prefs) => {
    asked++;
    prefs.set(p);
  };
  const load = () => {
    const n = ++asked;
    if (user.peek()?.email)
      api<Prefs>("GET", "/api/mail/prefs").then(
        (p) => n === asked && prefs.set(p),
        () => {},
      );
    else prefs.set(null);
  };
  // Again as an email is added (a guest signing in here), or the player signs out.
  effect(() => {
    user()?.email;
    untracked(load);
  });
  const set = (kind: "streak" | "day") => async (on: boolean) => {
    const was = prefs.peek();
    if (!was) return;
    error.set("");
    now({ ...was, [kind]: on });
    try {
      now(await api<Prefs>("PATCH", "/api/mail/prefs", { kind, on }));
    } catch (err) {
      now(was);
      error.set(errorText(err));
    }
  };
  // The guest's ask: once it's turning the reminder on (their email given and proved), it stays to say what came of
  // it (the game kept, the reminder on), over the switches that come with the email.
  const turning = signal(false);
  const guestAsk = mailAsk({ folded: true, turning: () => turning.set(true), yes: now });
  const row: Child = [
    () => (turning() || (!user()?.email && ask()) ? guestAsk : null),
    () =>
      prefs()?.can
        ? [
            switchRow(
              "Напомняне по имейл",
              "Веднъж на ден, около часа, в който играеш, ако въпросите още те чакат.",
              () => prefs()?.day ?? false,
              set("day"),
            ),
            switchRow(
              "Имейл, когато серията ти прекъсне",
              "Едно писмо, ако серия от 5 дни или повече прекъсне. Най-много едно на 30 дни.",
              () => prefs()?.streak ?? false,
              set("streak"),
            ),
            () => error() && h("p", { class: "bad", role: "alert" }, error()),
          ]
        : null,
  ];
  return { row, load };
}

/** Notifications, always (where they can't come, it says why): on or off on this device, and which kinds the player
 * gets (on every device they have them on); and for whom no notification reaches, mail (byMail). */
function reminders(): Child {
  const head = h("h2", null, "Известия");
  if (needsHomeScreen() || !pushable()) {
    const mail = byMail(() => true);
    return h(
      "section",
      { class: "stack" },
      head,
      h(
        "p",
        { class: "muted" },
        needsHomeScreen()
          ? "На iPhone известията идват, щом добавиш АЛМАНАХ към началния екран: Сподели → Добави към началния екран. После ги включи оттук."
          : "Този браузър не поддържа известия.",
      ),
      mail.row,
    );
  }
  const on = signal<boolean | null>(null);
  // Refused by the browser (before, or just now): the mail is offered instead.
  const denied = () => typeof Notification !== "undefined" && Notification.permission === "denied";
  const refused = signal(denied());
  const mail = byMail(() => on() === false && refused());
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
        if (why) {
          error.set(why);
          refused.set(denied());
        } else {
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
    head,
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
                      kind("friends", "Приятели и дуели", "Покани за приятелство и как са свършили игрите ти."),
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
