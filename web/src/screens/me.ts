// Профил: who you are in the game, in its budget's order (DESIGN.md, Places): your avatar with the seal you wear on its
// corner, your name and tag; the longest streak; the seal you wear on its ladder of ranks; your seals, a chapter's each,
// the one worn ringed and a tap wearing another; the avatars (every animal yours, a chapter's art yours from its
// Страница); and Настройки, last. A guest is asked to keep their game, and the way in for a profile from elsewhere is
// apart from it. No lifetime totals.

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { Stats } from "./stats.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  api,
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
  errorText,
  profileHref,
  haveProfile,
  keepGame,
  loadStats,
  formatNumber,
  categories,
  chapterName,
  ladder,
  seal,
  worn,
  illustration,
} = {} as Kit;

/** A chapter's rank, as the book has it (play.ChapterRank). */
interface Rank {
  chapter: string;
  level: number;
  name: string;
  /** The facts in the chapter in ink. */
  ink?: number;
}

export function me(kit: Kit) {
  ({
    api,
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
    errorText,
    profileHref,
    haveProfile,
    keepGame,
    loadStats,
    formatNumber,
    categories,
    chapterName,
    ladder,
    seal,
    worn,
    illustration,
  } = kit);
  title("Профил");
  // Come by „Вход“ (the bar's, a guest's): the way in open at once.
  const signingIn = location.hash === "#signin";
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
        const ranks = signal<Rank[] | null>(null);
        // Профил that couldn't load (no line): said, with the way to try again (the whole page, afresh).
        const failed = signal<unknown>(null);
        loadStats().then(data.set, failed.set);
        // The ranks, as others see them on the player's page (not the book's: opening it is counted as opening the book).
        const tag = user.peek()?.tag;
        if (tag)
          api<{ ranks?: Rank[] }>("GET", `/api/players/${encodeURIComponent(tag)}`).then(
            (p) => ranks.set(p.ranks ?? []),
            () => ranks.set([]),
          );
        else ranks.set([]);
        // The avatars: their own part (screens/avatar.ts), loaded with the page.
        const picker = signal<Child>(null);
        import("./avatar.ts").then((m) => picker.set(m.picker(kit, () => ranks() ?? [])));
        return [
          h(
            "div",
            { class: "me-intro page-1" },
            said ? h("p", { class: "muted", role: "status" }, said) : null,
            head(data),
            () => (failed() && !data() ? failure(failed(), () => go("/me", true)) : null),
            // A guest keeps their game with an email; one who has a profile elsewhere signs in to it, apart, in a
            // smaller line. Either way, Профил again, as the profile has it.
            () =>
              user()?.email
                ? null
                : [keepGame(() => go("/me", true)), haveProfile(() => go("/me", true), "Имаш профил? Влез", signingIn)],
            () => longest(data()),
            () => wornLadder(data()),
            () =>
              user()?.tag
                ? h(
                    "p",
                    { class: "me-links" },
                    h("a", { class: "link muted", href: profileHref(user()?.tag ?? "") }, "Как те виждат другите"),
                  )
                : null,
          ),
          h(
            "div",
            { class: "me-side page-2" },
            () => seals(ranks(), data(), data.set),
            h(
              "section",
              { class: "sect me-avatars" },
              h("div", { class: "sect-head" }, h("h2", null, "Аватар")),
              picker,
            ),
            h(
              "a",
              { class: "me-settings", href: "/settings" },
              h("span", { class: "i i-gear", "aria-hidden": "true" }),
              h(
                "span",
                { class: "me-settings-text" },
                h("strong", null, "Настройки"),
                h("span", { class: "muted" }, "Изглед, звук, напомняне, име, имейл и профил"),
              ),
              h("span", { class: "i i-right me-settings-i", "aria-hidden": "true" }),
            ),
          ),
        ];
      },
      // No player here yet („Вход“ in the bar): the sign-in form at once.
      () => [
        h("h1", null, "Вход"),
        h(
          "p",
          { class: "lead" },
          "Имаш профил? Влез с имейла си. Ако нямаш, профилът се създава сам с първата ти игра.",
        ),
        haveProfile(() => go("/me", true), undefined, true, undefined, true),
      ],
    ),
  );
}

/** Who you are: your avatar as you wear it, the seal you wear on its corner, your name and tag; a name still the one
 * drawn says so, with the way to change it. */
function head(data: () => Stats | null): Child {
  return h(
    "div",
    { class: "me-head" },
    h(
      "span",
      { class: "me-avatar" },
      () => avatar(look(), { size: "l", name: user.peek()?.name }),
      () => worn(data()?.seal, 48),
    ),
    h(
      "div",
      { class: "me-who" },
      h("h1", null, () => user()?.name ?? "Профил"),
      () => (user()?.tag ? h("span", { class: "me-tag" }, `@${user()?.tag}`) : null),
      () =>
        user()?.drawn
          ? h(
              "p",
              { class: "me-drawn muted" },
              "Това име е избрано наслуки. ",
              h("a", { class: "link", href: "/settings#name" }, "Смени името"),
            )
          : h("a", { class: "link me-rename", href: "/settings#name" }, "Смени името"),
    ),
  );
}

/** The longest streak: its number and words, the flame by it; under it, what the week forgives. Nothing before a
 * first day. */
function longest(s: Stats | null): Child {
  if (!s?.best) return null;
  return [
    h(
      "div",
      { class: "streak-chip me-longest" },
      illustration("flame", "streak-flame"),
      h("b", { class: "status-n" }, formatNumber(s.best)),
      h(
        "span",
        { class: "status-text" },
        h("span", { class: "status-label" }, s.best === 1 ? "ден" : "дни"),
        h("span", { class: "streak-note" }, "най-дълга серия"),
      ),
    ),
    h(
      "p",
      { class: "small muted me-forgives" },
      s.spare
        ? s.perWeek === 1
          ? "Един пропуснат ден в седмицата не прекъсва серията."
          : "До два пропуснати дни в седмицата не прекъсват серията."
        : "Тази седмица простените дни са използвани: следващият пропуснат ден прекъсва серията.",
    ),
  ];
}

/** The seal worn, on its ladder: „Печатът на География“, its ink (as the book has it, the number its Алманах card
 * shows), and the ranks from Бележка to Летопис, the one reached ringed. Nothing before a first seal. */
function wornLadder(s: Stats | null): Child {
  const w = s?.seal;
  if (!w?.chapter || w.level < 1) return null;
  const ink = s?.ink;
  return h(
    "section",
    { class: "sect me-ladder" },
    h(
      "div",
      { class: "sect-head" },
      h("h2", null, `Печатът на ${chapterName(w.chapter)}`),
      ink ? h("span", { class: "sect-note" }, `${formatNumber(ink)} с мастило`) : null,
    ),
    ladder(w.chapter, w.level),
  );
}

/** The seals: a chapter's each, once it has a rank, its name under it; the one worn ringed, and a tap wears another
 * (Профил's numbers, and with them the head's seal, asked again: `told`). Before any: what brings the first. */
function seals(ranks: Rank[] | null, s: Stats | null, told: (s: Stats) => void): Child {
  if (!ranks) return null;
  const had = categories.map((c) => ranks.find((r) => r.chapter === c.id)).filter((r): r is Rank => !!r && r.level > 0);
  const wearing = signal(s?.seal?.chapter ?? "");
  // Choosing another: the seals become buttons, and a tap wears one.
  const choosing = signal(false);
  const error = signal("");
  const choose = () => {
    choosing.update((c) => !c);
    if (choosing.peek()) api("POST", "/api/me/used", { noun: "seal" }).catch(() => {});
  };
  const wear = async (chapter: string) => {
    error.set("");
    const was = wearing.peek();
    wearing.set(chapter);
    choosing.set(false);
    try {
      await api("PATCH", "/api/me/seal", { chapter });
      loadStats().then(told, () => {});
    } catch (err) {
      wearing.set(was);
      error.set(errorText(err));
    }
  };
  const item = (r: Rank) => [
    seal(r.chapter, r.level, 40),
    h("span", { class: "rk-words" }, h("b", null, chapterName(r.chapter)), h("span", null, r.name)),
  ];
  return h(
    "section",
    { class: "sect me-seals" },
    h("div", { class: "sect-head" }, h("h2", null, "Печати")),
    had.length
      ? [
          h("p", { class: "seal-worn" }, () =>
            choosing()
              ? [
                  "Докосни печата, който искаш да носиш. ",
                  h("button", { class: "link", type: "button", onclick: choose }, "Готово"),
                ]
              : [
                  wearing() ? `Носиш печата на глава „${chapterName(wearing())}“ · ` : "",
                  had.length > 1 || !wearing()
                    ? h(
                        "button",
                        { class: "link", type: "button", onclick: choose },
                        wearing() ? "избери друг" : "избери",
                      )
                    : null,
                ],
          ),
          h("ul", { class: "seal-list" }, () =>
            had.map((r) =>
              h(
                "li",
                null,
                choosing()
                  ? h(
                      "button",
                      {
                        class: "rk",
                        type: "button",
                        "aria-pressed": wearing() === r.chapter,
                        onclick: () => wear(r.chapter),
                      },
                      item(r),
                    )
                  : h("span", { class: wearing() === r.chapter ? "rk worn" : "rk" }, item(r)),
              ),
            ),
          ),
        ]
      : [
          h("p", { class: "seal-worn" }, "Още нямаш печат."),
          h(
            "p",
            { class: "small" },
            "Печат на глава получаваш с първия ѝ факт с мастило – при верен отговор в броя на деня.",
          ),
        ],
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}
