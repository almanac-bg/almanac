// Профил: who you are in the game, as a spread. On the left page your avatar, name and tag, how the streak stands
// (days in a row, the longest, the issues played) and the ways on (all your games, how others see you); on the right
// the avatars, every one yours, a tap wearing it, and Настройки. A guest is asked to keep their game, from the first
// one, and the way in for a profile from elsewhere is apart from it.

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { Stats } from "./stats.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  h,
  signal,
  when,
  go,
  title,
  user,
  notice,
  avatar,
  look,
  failure,
  profileHref,
  haveProfile,
  keepGame,
  loadStats,
  formatNumber,
} = {} as Kit;

export function me(kit: Kit) {
  ({
    h,
    signal,
    when,
    go,
    title,
    user,
    notice,
    avatar,
    look,
    failure,
    profileHref,
    haveProfile,
    keepGame,
    loadStats,
    formatNumber,
  } = kit);
  title("Профил");
  // A game just kept, or a profile signed in to, here (keepGame, haveProfile): said once, at the top.
  const said = notice.peek();
  notice.set("");
  return h(
    "section",
    { class: "screen me spread" },
    when(
      () => user(),
      () => {
        const data = signal<Stats | null>(null);
        // Профил that couldn't load (no line): said, with the way to try again (the whole page, afresh).
        const failed = signal<unknown>(null);
        loadStats().then(data.set, failed.set);
        // The avatars: their own part (screens/avatar.ts), loaded with the page.
        const picker = signal<Child>(null);
        import("./avatar.ts").then((m) => picker.set(m.picker(kit)));
        return [
          h(
            "div",
            { class: "me-intro page-1" },
            said ? h("p", { class: "muted", role: "status" }, said) : null,
            head(),
            () => (failed() && !data() ? failure(failed(), () => go("/me", true)) : null),
            // A guest keeps their game with an email; one who has a profile elsewhere signs in to it, apart, in a
            // smaller line. Either way, Профил again, as the profile has it.
            () =>
              user()?.email
                ? null
                : [keepGame(() => go("/me", true)), haveProfile(() => go("/me", true), "Имаш профил? Влез")],
            () => figures(data()),
            h("p", { class: "me-links" }, h("a", { class: "link", href: "/games" }, "Всички игри"), () =>
              user()?.tag
                ? h("a", { class: "link muted", href: profileHref(user()?.tag ?? "") }, "Как те виждат другите")
                : null,
            ),
          ),
          h(
            "div",
            { class: "me-side page-2" },
            h(
              "section",
              { class: "sect me-avatars" },
              h(
                "div",
                { class: "sect-head" },
                h("h2", null, "Аватар"),
                h("span", { class: "sect-note" }, "Всички са твои"),
              ),
              picker,
            ),
            h(
              "section",
              { class: "sect me-settings-sect" },
              h(
                "a",
                { class: "me-settings", href: "/settings" },
                h(
                  "span",
                  { class: "me-settings-text" },
                  h("strong", null, "Настройки"),
                  h("span", { class: "muted" }, "Изглед, звуци, напомняне, името, имейлът и профилът"),
                ),
                h("span", { class: "i i-left me-settings-i", "aria-hidden": "true" }),
              ),
            ),
          ),
        ];
      },
      () => [
        h("h1", null, "Профил"),
        h("p", { class: "lead" }, "Още нямаш профил. Създава се сам с първата ти игра. Или тук, с имейл."),
        h("a", { class: "btn primary big", href: "/settings" }, "Влез с имейл"),
      ],
    ),
  );
}

/** Who you are: your avatar as you wear it, your name and tag; a name still the one drawn says so, with the way to
 * change it. */
function head(): Child {
  return h(
    "div",
    { class: "me-head" },
    h("span", { class: "me-avatar" }, () => avatar(look(), { size: "l", name: user.peek()?.name })),
    h("h1", null, () => user()?.name ?? "Профил"),
    () => (user()?.tag ? h("span", { class: "me-tag" }, `@${user()?.tag}`) : null),
    () =>
      user()?.drawn
        ? h(
            "p",
            { class: "me-drawn muted" },
            "Това име е избрано наслуки. ",
            h("a", { class: "link", href: "/settings#name" }, "Смени го"),
          )
        : h("a", { class: "link me-rename", href: "/settings#name" }, "Промени името"),
  );
}

/** How the streak stands: days in a row and the longest, and the seal worn; what the streak forgives under them. */
function figures(s: Stats | null): Child {
  if (!s) return null;
  const fig = (n: number, label: string) =>
    h("div", { class: "fig" }, h("b", { class: "fig-n" }, formatNumber(n)), h("span", { class: "fig-label" }, label));
  return [
    h(
      "div",
      { class: "figures-row me-figures" },
      fig(s.streak, s.streak === 1 ? "ден поред" : "дни поред"),
      fig(s.best, "най-дългата серия"),
      s.seal
        ? h(
            "div",
            { class: "fig" },
            h("b", { class: "fig-n" }, s.seal.name),
            h("span", { class: "fig-label" }, "печат"),
          )
        : null,
    ),
    // What keeps the streak through a day missed: the week's days, forgiven by themselves (play/runs.go).
    h(
      "p",
      { class: "small muted" },
      s.spare
        ? s.perWeek === 1
          ? "Един пропуснат ден в седмицата не прекъсва серията."
          : "До два пропуснати дни в седмицата не прекъсват серията."
        : "Тази седмица простените дни са използвани: следващият пропуснат прекъсва серията.",
    ),
  ];
}
