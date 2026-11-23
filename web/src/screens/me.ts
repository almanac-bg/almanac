// Профил: who you are in the game, in its budget's order (DESIGN.md, Places): your avatar (a tap on it, its pencil on
// it, opens the animals on a sheet: screens/avatar.ts), your name and tag, and the streak as it is now under them, as
// another's page has it; your seals, one list, a row a chapter with its rank, its progress to the next and its ink, the
// most ink first, the book's whole ink beside „Печати“; and Настройки, last. One column, on a big screen too. A guest
// is asked to keep their game, and the way in for a profile from elsewhere is apart from it (the sign-in page:
// screens/signin.ts, signInPage). Nobody on this device yet: that page instead. No lifetime totals but
// the book's ink (DECISIONS.md: ink, summed, earned only by the day's issue). No way to the page
// as others see it (/players/<tag>, which opens this page for one's own tag): it is this one without what's one's own
// (the avatar's pencil, Настройки, the week's forgiving on the streak).

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { ChapterRank } from "../ui.ts";
import type { Stats } from "./stats.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  api,
  lastOf,
  setIfNew,
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
    lastOf,
    setIfNew,
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
        // Come back to, Профил as it was last shown, at once, and anew in place where it has changed (api.ts, lastOf).
        const tag = user.peek()?.tag;
        const theirs = tag ? `/api/players/${encodeURIComponent(tag)}` : "";
        const data = signal<Stats | null>(lastOf<Stats>("/api/me/stats") ?? null);
        const ranks = signal<ChapterRank[] | null>(
          theirs ? (lastOf<{ ranks?: ChapterRank[] }>(theirs)?.ranks ?? null) : null,
        );
        // Профил that couldn't load (no line): said, with the way to try again (the whole page, afresh).
        const failed = signal<unknown>(null);
        loadStats().then(
          (s) => setIfNew(data, s),
          (err) => {
            if (!data.peek()) failed.set(err);
          },
        );
        // The ranks, as others see them on the player's page (not the book's: opening it is counted as opening the
        // book).
        if (theirs)
          api<{ ranks?: ChapterRank[] }>("GET", theirs).then(
            (p) => setIfNew(ranks, p.ranks ?? []),
            () => {
              if (!ranks.peek()) ranks.set([]);
            },
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

/** Who you are: your avatar, and a pencil on it (a tap on the avatar opens the animals: `pick`); your name and tag,
 * the streak as it is now under them (said to you: „Играеш от …“). The same head as another's page (ui.ts,
 * profileHead), but for what the week forgives: yours, on the streak for a pointer resting on it. */
function head(data: () => Stats | null, pick: () => void): Child {
  return profileHead(
    // The avatar is the button: a pencil on its corner says so (on a big screen as the pointer comes over it, with the
    // tooltip; on a phone always), never a word beside it.
    h(
      "button",
      { class: "me-avatar", type: "button", "aria-label": "Смени аватара", title: "Смени аватара", onclick: pick },
      () => avatar(look(), { size: "l", name: user.peek()?.name }),
      h("span", { class: "me-avatar-edit", "aria-hidden": "true" }, h("span", { class: "i i-pencil" })),
    ),
    () => nameWords(user()?.name ?? "Профил"),
    () => user()?.tag,
    () => data()?.streak,
    () => forgives(data()),
    true,
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
 * now (the number its Алманах card shows: Stats.ink); a view, no choice. Before any: what brings the first. */
function seals(ranks: ChapterRank[] | null, s: Stats | null): Child {
  if (!ranks) return null;
  return sealsSection(
    ranks.map((r) => ({ ...r, ink: s?.ink?.[r.chapter] ?? r.ink })),
    [
      h("p", { class: "seals-none" }, "Още нямаш печат."),
      h(
        "p",
        { class: "small" },
        "Печат за тема получаваш с първия ѝ факт с мастило — при верен отговор в броя на деня.",
      ),
    ],
  );
}
