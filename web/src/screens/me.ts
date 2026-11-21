// Профил: who you are in the game, in its budget's order (DESIGN.md, Places): your avatar with the seal you wear on its
// corner, your name and tag; the streak as it is now; your seals, one list, a row a chapter with its rank, its
// progress to the next and its ink (the one worn is the best: never chosen); the avatars (every animal yours); and
// Настройки, last. A guest is asked to keep their game, and the way in for a profile from elsewhere is apart from it
// (the sign-in page: screens/signin.ts, signInPage). Nobody on this device yet: that page instead. No lifetime totals.

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { ChapterRank } from "../ui.ts";
import type { Stats } from "./stats.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  api,
  h,
  nameWords,
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
  keepGame,
  loadStats,
  formatNumber,
  sealList,
  illustration,
} = {} as Kit;

export function me(kit: Kit) {
  ({
    api,
    h,
    nameWords,
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
    keepGame,
    loadStats,
    formatNumber,
    sealList,
    illustration,
  } = kit);
  title("Профил");
  // Nobody on this device yet: nothing of theirs to show, the way in instead (screens/signin.ts, signInPage).
  if (!user.peek()) {
    go("/signin", true);
    return null;
  }
  // A game just kept here (keepGame), or a profile signed in to from here (signInPage): said once, at the top.
  const said = notice.peek();
  notice.set("");
  return h(
    "section",
    { class: "screen me spread" },
    when(
      () => user(),
      () => {
        const data = signal<Stats | null>(null);
        const ranks = signal<ChapterRank[] | null>(null);
        // Профил that couldn't load (no line): said, with the way to try again (the whole page, afresh).
        const failed = signal<unknown>(null);
        loadStats().then(data.set, failed.set);
        // The ranks, as others see them on the player's page (not the book's: opening it is counted as opening the book).
        const tag = user.peek()?.tag;
        if (tag)
          api<{ ranks?: ChapterRank[] }>("GET", `/api/players/${encodeURIComponent(tag)}`).then(
            (p) => ranks.set(p.ranks ?? []),
            () => ranks.set([]),
          );
        else ranks.set([]);
        // The avatars: their own part (screens/avatar.ts), loaded with the page.
        const picker = signal<Child>(null);
        import("./avatar.ts").then((m) => picker.set(m.picker(kit)));
        return [
          h(
            "div",
            { class: "me-intro page-1" },
            said ? h("p", { class: "muted", role: "status" }, said) : null,
            head(data),
            () => (failed() && !data() ? failure(failed(), () => go("/me", true)) : null),
            // A guest keeps their game with an email, or signs in to a profile they have elsewhere, and sees how others
            // see them: one line of ways (not four loose ones before anything else). Either way in, Профил again, as
            // the profile has it.
            () => (user()?.email ? null : keepGame(() => go("/me", true), theirView(user()?.tag))),
            () => streakNow(data()),
            () => seals(ranks(), data()),
            () => (user()?.email && user()?.tag ? h("p", { class: "me-links" }, theirView(user()?.tag)) : null),
          ),
          h(
            "div",
            { class: "me-side page-2" },
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
      // No player here (signed out on another page since): the way in.
      () => h("p", null, h("a", { class: "link", href: "/signin" }, "Вход")),
    ),
  );
}

/** The way to the player's page as others see it (`/players/<tag>`); nothing without a tag. */
function theirView(tag: string | undefined): Child {
  return tag ? h("a", { class: "link muted", href: profileHref(tag) }, "Как те виждат другите") : null;
}

/** Who you are: your avatar as you wear it, the seal you wear on its corner, your name and tag; a name still the one
 * drawn says so, with the way to change it. */
function head(data: () => Stats | null): Child {
  return h(
    "div",
    { class: "me-head" },
    h("span", { class: "me-avatar" }, () => avatar(look(), { size: "l", name: user.peek()?.name, seal: data()?.seal })),
    h(
      "div",
      { class: "me-who" },
      h("h1", null, () => nameWords(user()?.name ?? "Профил")),
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

/** The streak as it is now: its number and words, the flame by it (never the longest: an ended streak's number is
 * never named, DECISIONS.md); under it, what the week forgives (that it has forgiven all it can, only while a streak
 * runs). Nothing while there's none. */
function streakNow(s: Stats | null): Child {
  if (!s?.streak) return null;
  return [
    h(
      "div",
      { class: "streak-chip me-streak" },
      illustration("flame", "streak-flame"),
      h("b", { class: "status-n" }, formatNumber(s.streak)),
      h(
        "span",
        { class: "status-text" },
        h("span", { class: "status-label" }, s.streak === 1 ? "ден в серията" : "дни в серията"),
      ),
    ),
    // The week's forgiving used up says something only of a streak that's running.
    s.spare || s.streak > 0
      ? h(
          "p",
          { class: "small muted me-forgives" },
          s.spare
            ? "До два пропуснати дни в седмицата не прекъсват серията."
            : "Тази седмица простените дни са използвани: следващият пропуснат ден прекъсва серията.",
        )
      : null,
  ];
}

/** The seals: one list, a row a chapter with a rank (ui.ts, sealList), its ink as the book has it now (the number its
 * Алманах card shows: Stats.ink); a view, no choice (the one worn on the avatar is the best: play.sealOf). Before any:
 * what brings the first. */
function seals(ranks: ChapterRank[] | null, s: Stats | null): Child {
  if (!ranks) return null;
  const list = sealList(ranks.map((r) => ({ ...r, ink: s?.ink?.[r.chapter] ?? r.ink })));
  return h(
    "section",
    { class: "sect me-seals" },
    h("div", { class: "sect-head" }, h("h2", null, "Печати")),
    list ?? [
      h("p", { class: "seal-worn" }, "Още нямаш печат."),
      h(
        "p",
        { class: "small" },
        "Печат на глава получаваш с първия ѝ факт с мастило — при верен отговор в броя на деня.",
      ),
    ],
  );
}
