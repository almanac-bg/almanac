// Настройки: the name and tag (saved as they're left), the account and its email, reminders, and the data the game
// keeps; and this device's look (Night or Day), sound and access, with a profile or without one.

import type { Kit } from "../kit.ts";
import type { ApiError } from "../lib/api.ts";
import type { Child, Signal } from "../lib/dom.ts";
import type { PushKind, PushPrefs } from "../lib/push.ts";
import type { User } from "../state.ts";
import type { MailPrefs } from "./keep.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  inSight,
  api,
  emailWords,
  errorText,
  computed,
  effect,
  h,
  onCleanup,
  signal,
  untracked,
  when,
  reportProblem,
  schemeSwitch,
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
  noEmail,
  mailAsk,
} = {} as Kit;

/** Signed out just now: said here, where it was done, and only here (Днес, next, doesn't say it again). */
let signedOut: Signal<boolean>;
/** What came of a code put in here just now (signIn: a game kept, a profile signed in to), said under the profile. */
let signedIn: Signal<string>;

export function settings(kit: Kit) {
  ({
    inSight,
    api,
    emailWords,
    errorText,
    computed,
    effect,
    h,
    onCleanup,
    signal,
    untracked,
    when,
    reportProblem,
    schemeSwitch,
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
    noEmail,
    mailAsk,
  } = kit);
  title("Настройки");
  notice.set("");
  signedOut = signal(false);
  signedIn = signal("");
  return h(
    "section",
    { class: "screen narrow" },
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
                : h(
                    "p",
                    { class: "lead" },
                    noEmail
                      ? "Още нямаш профил. Започни да играеш."
                      : "Още нямаш профил. Влез с имейл или започни да играеш.",
                  ),
            signIn({ form: "settings", done: (said) => signedIn.set(said) }),
          ),
          looks(),
          sounds(),
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
  let nameField: HTMLInputElement | undefined;
  let tagField: HTMLInputElement | undefined;
  // A name or tag changed and not saved yet.
  const changed = () => {
    const u = user.peek();
    return !!u && (name.peek().trim() !== u.name || tag.peek().trim() !== u.tag);
  };
  // What's typed is the news now: the last answer's words („Запазено.“, or why not) go with the first key.
  const typed = (to: (v: string) => void) => (e: Event) => {
    to((e.target as HTMLInputElement).value);
    note.set(null);
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
      // Why not, in the server's words (the rule, said the same everywhere), and the field it's about, to change.
      note.set({ text: errorText(err), bad: true });
      const code = (err as ApiError).code ?? "";
      (code === "bad_tag" || code === "tag_taken" ? tagField : code.endsWith("_name") ? nameField : undefined)?.focus();
    } finally {
      busy.set(false);
    }
  };
  // Saved as the form is left, and as the screen is: a name changed is never dropped by going elsewhere (one the
  // server refuses isn't saved, and nothing else with it).
  const saveIfChanged = () => {
    if (!busy.peek() && changed()) save();
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
        ref: (el) => {
          nameField = el as HTMLInputElement;
        },
        // Room past the rule's 30, so that a longer name is refused in words (the server's), never cut short and saved.
        maxlength: 60,
        value: name,
        oninput: typed(name.set),
      }),
      // Seen by everyone (the boards, a duel, a link's preview): no more than a player means to show.
      h("small", { class: "muted", id: "name-how" }, "Виждат го всички в играта. Стига прякор или малкото ти име."),
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
          maxlength: 20,
          value: tag,
          ref: (el) => {
            tagField = el as HTMLInputElement;
          },
          oninput: typed(tag.set),
        }),
      ),
      // One player's only, but never private: it's on their page for anyone to see (account.NormalTag's rule after).
      h(
        "small",
        { class: "muted", id: "tag-how" },
        "Никой друг няма същото. По него те намират приятелите и го виждат в профила ти. Латински букви, цифри, точка и долна черта.",
      ),
    ),
    h("button", { class: "btn", disabled: busy }, "Запази"),
    () => {
      const n = note();
      return n && h("p", { class: n.bad ? "bad" : "muted", role: n.bad ? "alert" : "status" }, n.text);
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
          h("strong", null, () => emailWords(user()?.email ?? "")),
          ".",
        ),
        h("button", { class: "link tap", onclick: signOut }, "Излез"),
        signOutOthers(),
      ],
      () => [
        h("h2", null, "Запази играта си"),
        h(
          "p",
          { class: "muted" },
          // Where no email is asked for, none is offered: the line under it says why, and the way.
          noEmail
            ? "Засега играта ти е само на това устройство."
            : "Засега играта ти е само на това устройство. Добави имейл и ще я имаш навсякъде, където влезеш с него. Вече имаш профил? Влез с имейла му и играта оттук ще се добави към него.",
        ),
        signIn({ form: "settings-keep", done: (said) => signedIn.set(said) }),
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

/** Sounds, the clock's last seconds among them: on or off, on this device. */
function sounds(): Child {
  return h(
    "section",
    null,
    h("h2", null, "Звук"),
    // That it holds for this device is said once, over Изглед, the first of the three.
    quietWhenSilent() ? h("p", { class: "muted" }, "Когато телефонът е в безшумен режим, звуци няма.") : null,
    switchRow("Звуци", "Часовникът, отговорите, серията.", soundOn, setSound),
    switchRow("Тиктакане", "Последните секунди на въпроса.", tickOn, setTick),
  );
}

/** Изглед: Night or Day, for this device; as the device is set until chosen. */
function looks(): Child {
  return h(
    "section",
    null,
    h("h2", null, "Изглед"),
    h("p", { class: "muted" }, "Изгледът и звукът важат за това устройство."),
    schemeSwitch(),
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
              "Веднъж на ден, около часа, в който играеш, ако броят още те чака.",
              () => prefs()?.day ?? false,
              set("day"),
            ),
            switchRow(
              "Писмо, когато серията ти прекъсне",
              "Ако прекъсне серия от 5 или повече дни. Най-много едно писмо на 30 дни.",
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
          : "Този браузър не поддържа известия. Напомнянията идват на устройствата, на които са включени.",
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
                // The section's own rows, spaced as Звук's switches are.
                prefs()
                  ? [
                      kind("day", "Днешният брой", "Веднъж на ден, около часа, в който играеш, ако още те чака."),
                      kind("friends", "Приятели", "Покани за приятелство и дуели."),
                    ]
                  : null,
              // The night's quiet (server/pushes.go): what's due then comes at 8:00.
              h("p", { class: "muted" }, "От 22:00 до 8:00 не пращаме известия."),
              h("button", { class: "link", onclick: toggle }, "Спри известията"),
            ]
          : [
              h("p", { class: "muted" }, "Днешният брой, приятели: ти избираш за какво."),
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
          {
            class: "stack",
            // The ask, at the page's foot: brought into view whole, its button clear of a phone's places.
            ref: inSight,
          },
          h("p", null, "Профилът, името и всичките ти игри ще бъдат изтрити завинаги."),
          h(
            "button",
            {
              class: "btn danger",
              onclick: async () => {
                try {
                  // This browser's notifications go too: kept, they'd come back to whoever plays here next, unasked
                  // (pushOn tells the server of them again). The server forgets them with the player.
                  if (pushable()) await turnOff().catch(() => {});
                  await api("DELETE", "/api/me");
                  // Nothing is left here: Днес, as for someone new, says so once.
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
          h("button", { class: "link tap", onclick: () => asking.set(false) }, "Отказ"),
          error() && h("p", { class: "bad", role: "alert" }, error()),
        )
      : h("button", { class: "link tap danger", onclick: () => asking.set(true) }, "Изтрий профила");
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
      said.set("Готово. Профилът ти вече е отворен само на това устройство.");
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
    h("button", { class: "link tap", onclick: run, disabled: busy }, "Излез от другите устройства"),
    () => said() && h("p", { class: bad() ? "bad" : "muted", role: "status" }, said()),
  ];
}
