// Профил: who you are in the game, in its budget's order (DESIGN.md, Places): your avatar with the seal you wear on its
// corner (a tap on it, or „Смени“ under it, opens the animals on a sheet: screens/avatar.ts), your name and tag with the
// streak as it is now by it; your seals, one list, a row a chapter with its rank, its progress to the next and its ink (the
// one worn is the best: never chosen); and Настройки, last. One column, on a big screen too. A guest is asked to keep
// their game, and the way in for a profile from elsewhere is apart from it (the sign-in page: screens/signin.ts,
// signInPage). Nobody on this device yet: that page instead. No lifetime totals. No way to the page as others see it
// (/players/<tag>): it is this one without what's one's own (Смени, Настройки, the week's forgiving on the streak).

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
  keepGame,
  loadStats,
  profileHead,
  sealsSection,
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
    keepGame,
    loadStats,
    profileHead,
    sealsSection,
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
    { class: "screen me" },
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
        // The avatars: a sheet of their own (screens/avatar.ts), loaded with the page so that a tap opens it at once.
        const avatars = import("./avatar.ts");
        const pick = () => avatars.then((m) => m.pickAvatar(kit));
        return [
          h(
            "div",
            { class: "me-intro" },
            said ? h("p", { class: "muted", role: "status" }, said) : null,
            head(data, pick),
            () => (failed() && !data() ? failure(failed(), () => go("/me", true)) : null),
            // A guest keeps their game with an email, or signs in to a profile they have elsewhere: one line of ways
            // (not loose ones before anything else). Either way in, Профил again, as the profile has it.
            () => (user()?.email ? null : keepGame(() => go("/me", true))),
            () => seals(ranks(), data()),
          ),
          h(
            "div",
            { class: "me-side" },
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

/** Who you are: your avatar as you wear it, the seal you wear on its corner, and „Смени“ under it (it, or a tap on the
 * avatar, opens the animals: `pick`); your name and tag, the streak as it is now by it; a name still the one drawn
 * says so, with the way to change it. The same head as another's page (ui.ts, profileHead), but for what the week
 * forgives: yours, on the streak for a pointer resting on it. */
function head(data: () => Stats | null, pick: () => void): Child {
  return profileHead(
    // One button, the avatar and its word: the whole of it a tap.
    h(
      "button",
      { class: "me-avatar", type: "button", "aria-label": "Смени аватара", onclick: pick },
      () => avatar(look(), { size: "l", name: user.peek()?.name, seal: data()?.seal }),
      h("span", { class: "me-avatar-change", "aria-hidden": "true" }, "Смени"),
    ),
    () => nameWords(user()?.name ?? "Профил"),
    () => user()?.tag,
    () => [
      user()?.drawn ? "Това име е избрано наслуки. " : null,
      h("a", { class: "link", href: "/settings#name" }, "Смени името"),
    ],
    () => data()?.streak,
    () => forgives(data()),
  );
}

/** What the week forgives, while a streak runs: two days missed, or that it has forgiven all it can. */
function forgives(s: Stats | null): string | undefined {
  if (!s?.streak) return undefined;
  return s.spare
    ? "До два пропуснати дни в седмицата не прекъсват серията."
    : "Тази седмица простените дни са използвани: следващият пропуснат ден прекъсва серията.";
}

/** The seals, as another's page has them (ui.ts, sealsSection): a row a chapter with a rank, its ink as the book has it
 * now (the number its Алманах card shows: Stats.ink); a view, no choice (the one worn on the avatar is the best:
 * play.sealOf). Before any: what brings the first. */
function seals(ranks: ChapterRank[] | null, s: Stats | null): Child {
  if (!ranks) return null;
  return sealsSection(
    ranks.map((r) => ({ ...r, ink: s?.ink?.[r.chapter] ?? r.ink })),
    [
      h("p", { class: "seal-worn" }, "Още нямаш печат."),
      h(
        "p",
        { class: "small" },
        "Печат на глава получаваш с първия ѝ факт с мастило — при верен отговор в броя на деня.",
      ),
    ],
  );
}
