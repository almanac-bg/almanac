// Профил: who you are in the game — your avatar, name, tag and title; your level and what comes next; your league in a
// line (its group is Класации'); your streak, numbers, mastery and latest games (the rating's division is the duels'
// and Роял's, on their screens) — with its own places a tap away at the top (Награди, Гардероб, Алманах) and
// Настройки beside your name, in words. A hub: each thing once, the whole of it a tap away. Each system shows once the
// player has met it (play/unfold.go): the level from the second day played, the league from the third. A guest is
// asked to keep their game, from the first one, and the way in for a profile from elsewhere is apart from it.

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { Unlock } from "../ui.ts";
import type { Progress } from "./progress.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  emblem,
  h,
  signal,
  when,
  go,
  title,
  user,
  notice,
  avatar,
  badge,
  explain,
  failure,
  levelNumber,
  meaning,
  meter,
  profileHref,
  profileNav,
  rewardWords,
  unlockPicture,
  unlockWords,
  haveProfile,
  keepGame,
  leagueLine,
  loadProgress,
  nearest,
  stats,
} = {} as Kit;

export function me(kit: Kit) {
  ({
    emblem,
    h,
    signal,
    when,
    go,
    title,
    user,
    notice,
    avatar,
    badge,
    explain,
    failure,
    levelNumber,
    meaning,
    meter,
    profileHref,
    profileNav,
    rewardWords,
    unlockPicture,
    unlockWords,
    haveProfile,
    keepGame,
    leagueLine,
    loadProgress,
    nearest,
    stats,
  } = kit);
  title("Профил");
  // A game just kept, or a profile signed in to, here (keepGame, haveProfile): said once, at the top.
  const said = notice.peek();
  notice.set("");
  return h(
    "section",
    { class: "screen" },
    when(
      () => user(),
      () => {
        const progress = signal<Progress | null>(null);
        // Профил that couldn't load (no line): said, with the way to try again (the whole page, afresh).
        const failed = signal<unknown>(null);
        loadProgress().then(progress.set, failed.set);
        return [
          profileNav(),
          said ? h("p", { class: "muted", role: "status" }, said) : null,
          head(progress),
          // A name still the one drawn: said so, with the way to change it.
          () =>
            user()?.drawn
              ? h(
                  "p",
                  { class: "me-drawn muted" },
                  "Това име е избрано наслуки. ",
                  h("a", { class: "link", href: "/settings#name" }, "Смени го"),
                )
              : null,
          () => (failed() && !progress() ? failure(failed(), () => go("/me", true)) : null),
          // A guest keeps their game with an email; one who has a profile elsewhere signs in to it, apart, in a smaller
          // line. Either way, Профил again, as the profile has it.
          () =>
            user()?.email
              ? null
              : [keepGame(() => go("/me", true)), haveProfile(() => go("/me", true), "Имаш профил? Влез")],
          () => {
            const p = progress();
            return p ? levelCard(p) : null;
          },
          // The league once it's open (play/unfold.go): from the third day played.
          () => (progress()?.open.league ? leagueLine() : null),
          stats(),
          () =>
            user()?.tag
              ? h("a", { class: "link muted tap", href: profileHref(user()?.tag ?? "") }, "Как те виждат другите")
              : null,
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

/** The player's look as Профил's head shows it, kept on this device by whose it is. */
interface Look {
  id: number;
  avatar: string;
  frame?: string;
  backdrop?: string;
  level?: number;
  title?: { name: string; tier: string };
}

const lookKey = "almanac.look";

/** The look last seen on this device for this player (null for none, or another player's). */
function lastLook(id: number): Look | null {
  try {
    const l = JSON.parse(localStorage.getItem(lookKey) ?? "null") as Look | null;
    return l?.id === id && typeof l.avatar === "string" ? l : null;
  } catch {
    return null; // no storage here, or nothing worth reading
  }
}

function keepLook(l: Look): void {
  try {
    localStorage.setItem(lookKey, JSON.stringify(l));
  } catch {
    // not kept: a plain disc while the next Профил loads
  }
}

/** Who you are: your avatar (with its level), your name, the title you wear and your tag; and Настройки, in words as
 * well as its picture, at every width. */
function head(progress: () => Progress | null): Child {
  // The player's look as their progress has it; until it comes (or if it can't), as it was last seen on this device:
  // never a look drawn from the name, which reads as someone else's profile; and with none seen yet, a plain disc.
  const look = (): Look | null => {
    const p = progress();
    const id = user.peek()?.id;
    if (!p) return id ? lastLook(id) : null;
    const t = p.title ? p.titles.find((a) => a.id === p.title) : undefined;
    const l: Look = {
      id: id ?? 0,
      avatar: p.avatar,
      frame: p.frame,
      backdrop: p.backdrop,
      level: p.open.xp ? p.level : undefined,
      title: t ? { name: t.name, tier: t.tier } : undefined,
    };
    if (id) keepLook(l);
    return l;
  };
  return h(
    "div",
    { class: "me-head" },
    () => {
      const l = look();
      return l
        ? avatar(l.avatar, { size: "l", level: l.level, name: user.peek()?.name, frame: l.frame, backdrop: l.backdrop })
        : h("span", { class: "avatar l avatar-unknown", "aria-hidden": "true" });
    },
    h(
      "div",
      { class: "me-head-text" },
      h("h1", null, () => user()?.name ?? "Профил"),
      () => {
        const t = look()?.title;
        return t ? h("span", { class: `me-title t-${t.tier}` }, t.name) : null;
      },
      () => (user()?.tag ? h("span", { class: "me-tag" }, `@${user()?.tag}`) : null),
    ),
    h(
      "a",
      { class: "btn me-settings", href: "/settings" },
      h("span", { class: "i i-tune", "aria-hidden": "true" }),
      "Настройки",
    ),
  );
}

/** The level, and what comes next: the XP to the next level and what the next that unlocks something brings, the
 * division above, the next title of the days with the day's questions („ден 87 от 100“), and the two achievements
 * nearest — so that every way of playing shows where it leads. Before XP is open (a first day), the achievements only. */
function levelCard(p: Progress): Child {
  const { next } = p;
  const xp = p.open.xp;
  const near = nearest(p.achievements, 2);
  const share = p.to > p.from ? Math.round((100 * (p.xp - p.from)) / (p.to - p.from)) : 0;
  const division = next.division && p.standing.rated ? next.division : undefined;
  const days = xp ? next.days : undefined;
  const items = (list: Unlock[]) =>
    list.map((u) => h("span", { class: "next-unlock" }, unlockPicture(u, p.avatar), unlockWords(u)));
  return h(
    "section",
    { class: "card me-level" },
    xp
      ? h(
          "div",
          { class: "me-level-bar" },
          h(
            "div",
            { class: "level-head" },
            h("span", { class: "level-n" }, levelNumber(p.level)),
            h("span", { class: "muted" }, explain(`още ${p.to - p.xp} XP`, meaning.xp), ` до ниво ${p.level + 1}`),
          ),
          meter(share, `${share}% от ниво ${p.level}`),
        )
      : null,
    xp && next.level && next.levelUnlocks.length
      ? h(
          "p",
          { class: "next-level" },
          h(
            "span",
            { class: "muted" },
            next.level === p.level + 1
              ? `На ниво ${next.level}:`
              : `На ниво ${next.level} (още ${levelXP(next.level) - p.xp} XP):`,
          ),
          items(next.levelUnlocks),
        )
      : null,
    division || days || near.length
      ? [
          h("h2", { class: "kicker" }, "Следва"),
          h(
            "ul",
            { class: "next-list" },
            division
              ? h(
                  "li",
                  { class: "next-row" },
                  emblem(division.id, "m"),
                  h(
                    "span",
                    { class: "next-text" },
                    h("strong", null, `Дивизия ${division.name}`),
                    h(
                      "span",
                      { class: "muted" },
                      `при рейтинг ${division.from} (още ${division.from - p.standing.rating})`,
                    ),
                    next.divisionUnlocks.length
                      ? h("span", { class: "next-unlocks" }, items(next.divisionUnlocks))
                      : null,
                  ),
                )
              : null,
            days
              ? h(
                  "li",
                  { class: "next-row" },
                  unlockPicture(days.title, p.avatar),
                  h(
                    "span",
                    { class: "next-text" },
                    h("strong", null, unlockWords(days.title)),
                    h("span", { class: "muted" }, `${days.days} дни с въпросите на деня`),
                    meter(Math.round((100 * days.have) / days.days), `ден ${days.have} от ${days.days}`),
                    h("span", { class: "next-reward" }, `ден ${days.have} от ${days.days}`),
                  ),
                )
              : null,
            near.map((a) =>
              h(
                "li",
                { class: `next-row t-${a.tier}` },
                badge(a, false, "s"),
                h(
                  "span",
                  { class: "next-text" },
                  h("strong", null, a.name),
                  h("span", { class: "muted" }, a.about),
                  (a.goal ?? 1) > 1
                    ? meter(Math.round((100 * (a.progress ?? 0)) / (a.goal ?? 1)), `${a.progress ?? 0} от ${a.goal}`)
                    : null,
                  h("span", { class: "next-reward" }, rewardWords(xp ? a : { ...a, xp: 0 })),
                ),
              ),
            ),
          ),
        ]
      : null,
    h("a", { class: "link tap", href: "/rewards" }, "Всички постижения"),
  );
}

/** The XP a level starts at (as the server's LevelOf: 300 for the first step, 150 more for each after). */
function levelXP(level: number): number {
  let from = 0;
  for (let l = 1, step = 300; l < level; l++, step += 150) from += step;
  return from;
}
