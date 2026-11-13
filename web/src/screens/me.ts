import { levelCard } from "../game/news.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal, when } from "../lib/dom.ts";
import { reportProblem } from "../lib/errors.ts";
import { needsHomeScreen, pushable, pushOn, turnOff, turnOn } from "../lib/push.ts";
import { title } from "../lib/router.ts";
import { setSound, soundOn } from "../lib/sound.ts";
import { type User, user } from "../state.ts";
import { type AchievementInfo, avatar, badge, shapeNames, type Tier, tiers, tierWords, toneNames } from "../ui.ts";
import { stats } from "./stats.ts";

export function me() {
  title("Профил");
  return h(
    "section",
    { class: "screen" },
    when(
      () => user(),
      () => {
        const progress = signal<Progress | null>(null);
        const load = () => api<Progress>("GET", "/api/me/progress").then(progress.set, () => {});
        load();
        return [
          head(progress),
          () => {
            const p = progress();
            return p ? levelCard(p.level, p.points, p.from, p.to) : null;
          },
          stats(),
          () => {
            const p = progress();
            return p ? achievements(p) : null;
          },
          h(
            "div",
            { class: "settings" },
            look(progress, load),
            sounds(),
            reminders(),
            nameForm(),
            account(),
            h(
              "section",
              null,
              h("h2", null, "Данните ти"),
              h("p", null, h("a", { href: "/privacy" }, "Какво пазим и защо")),
              deleteAccount(),
            ),
          ),
        ];
      },
      () => [
        h("h1", null, "Профил"),
        h("p", { class: "lead" }, "Още нямаш профил. Той се прави сам, щом започнеш да играеш, или тук, с имейл."),
        signIn(),
      ],
    ),
  );
}

interface Progress {
  level: number;
  points: number;
  from: number;
  to: number;
  achievements: AchievementInfo[];
  avatar: string;
  title: string;
  shapes: { shape: string; locked?: boolean; how?: string }[];
  tones: string[];
}

/** Who you are in the game: your avatar with your level, your name, your title. */
function head(progress: () => Progress | null): Child {
  return h(
    "div",
    { class: "me-head" },
    () => {
      const p = progress();
      return avatar(p?.avatar, { size: "l", level: p?.level, name: user.peek()?.name });
    },
    h(
      "div",
      { class: "me-head-text" },
      h("h1", null, () => user()?.name ?? "Профил"),
      () => {
        const p = progress();
        const t = p?.achievements.find((a) => a.id === p.title);
        return t ? h("span", { class: `me-title t-${t.tier}` }, t.name) : null;
      },
    ),
  );
}

/** A sentence as a clause after a colon: its first letter small. */
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const day = (ms: number) => new Intl.DateTimeFormat("bg", { day: "numeric", month: "long" }).format(new Date(ms));

/** Every achievement, by tier: the earned ones bright, with the day; each with how it's earned. */
function achievements(p: Progress): Child {
  const earned = p.achievements.filter((a) => a.at).length;
  return h(
    "section",
    { class: "stack" },
    h("h2", { class: "section-title" }, `Постижения · ${earned} от ${p.achievements.length}`),
    tiers.map((tier) => {
      const list = p.achievements.filter((a) => a.tier === tier);
      if (!list.length) return null;
      return h(
        "section",
        { class: `tier t-${tier}` },
        h(
          "h3",
          { class: "tier-head" },
          tierWords[tier].group,
          h("span", { class: "muted" }, ` · ${list.filter((a) => a.at).length} от ${list.length}`),
        ),
        h(
          "ul",
          { class: "achievements" },
          list.map((a) =>
            h(
              "li",
              { class: a.at ? "achievement" : "achievement locked" },
              badge(a, !!a.at),
              h(
                "div",
                { class: "achievement-text" },
                h("span", { class: "achievement-name" }, a.name),
                h("span", { class: "achievement-about" }, a.about),
                h("span", { class: "achievement-when" }, a.at ? `Спечелено на ${day(a.at)}` : "Още не е спечелено"),
              ),
            ),
          ),
        ),
      );
    }),
  );
}

/** How you look to others: the avatar's shape and tone, and a title from your achievements. */
function look(progress: () => Progress | null, reload: () => Promise<void>): Child {
  const hint = signal("");
  const error = signal("");
  const set = async (body: { avatar?: string; title?: string }) => {
    error.set("");
    hint.set("");
    try {
      await api("PATCH", "/api/me/look", body);
      await reload();
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };
  return () => {
    const p = progress();
    if (!p) return null;
    const [shape = "", tone = ""] = p.avatar.split("-");
    // Every title, by tier: the earned ones to wear, the rest with what unlocks them.
    const titles = tiers.flatMap((t: Tier) => p.achievements.filter((a) => a.tier === t));
    return h(
      "section",
      null,
      h("h2", null, "Вид"),
      h("p", { class: "muted" }, "Аватарът ти е форма в цвят. Някои форми се отключват с постижения."),
      h(
        "ul",
        { class: "picker" },
        p.shapes.map((s) =>
          h(
            "li",
            null,
            h(
              "button",
              {
                class: s.locked ? "pick locked" : "pick",
                type: "button",
                "aria-pressed": s.shape === shape,
                "aria-label": s.locked ? `${shapeNames[s.shape]}, заключена` : shapeNames[s.shape],
                onclick: () =>
                  s.locked
                    ? hint.set(
                        s.shape === "crown"
                          ? "Короната се отключва на ниво 10."
                          : `${shapeNames[s.shape]}: отключва се с постижението „${s.how}“.`,
                      )
                    : set({ avatar: `${s.shape}-${tone}` }),
              },
              avatar(`${s.shape}-${tone}`),
            ),
          ),
        ),
      ),
      () => hint() && h("p", { class: "muted", role: "status" }, hint()),
      h(
        "div",
        { class: "tones" },
        p.tones.map((t) =>
          h("button", {
            class: `tone-pick tone-${t}`,
            type: "button",
            "aria-pressed": t === tone,
            "aria-label": `Цвят: ${toneNames[t]}`,
            onclick: () => set({ avatar: `${shape}-${t}` }),
          }),
        ),
      ),
      h("h3", null, "Титла"),
      h("p", { class: "muted" }, "Титлата се вижда под името ти. Всяко постижение отключва една."),
      h(
        "ul",
        { class: "titles" },
        h(
          "li",
          null,
          h(
            "button",
            { class: "title-pick", type: "button", "aria-pressed": !p.title, onclick: () => set({ title: "" }) },
            h("span", { class: "title-name" }, "Без титла"),
          ),
        ),
        titles.map((a) =>
          h(
            "li",
            null,
            a.at
              ? h(
                  "button",
                  {
                    class: `title-pick t-${a.tier}`,
                    type: "button",
                    "aria-pressed": a.id === p.title,
                    onclick: () => set({ title: a.id }),
                  },
                  h("span", { class: "title-name" }, a.name),
                  h("span", { class: "title-tier" }, tierWords[a.tier].title),
                )
              : h(
                  "div",
                  { class: `title-pick locked t-${a.tier}` },
                  h("span", { class: "title-name" }, a.name),
                  h("span", { class: "title-tier" }, tierWords[a.tier].title),
                  h("span", { class: "title-how" }, `Отключва се: ${lower(a.about)}`),
                ),
          ),
        ),
      ),
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
    );
  };
}

function nameForm(): Child {
  const name = signal(user.peek()?.name ?? "");
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
          const r = await api<{ user: User }>("PATCH", "/api/me", { name: name.peek() });
          user.set(r.user);
          name.set(r.user.name);
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
        autocomplete: "nickname",
        minlength: 2,
        maxlength: 20,
        required: true,
        value: name,
        oninput: (e: Event) => name.set((e.target as HTMLInputElement).value),
      }),
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
    h(
      "p",
      { class: "muted" },
      "Кратки звуци при отговор, в последните секунди и при ново ниво. Важи за това устройство.",
    ),
    h("button", { class: "btn", type: "button", onclick: () => setSound(!soundOn.peek()) }, () =>
      soundOn() ? "Изключи звуците" : "Включи звуците",
    ),
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
