// Профил: who you are in the game — your avatar, name, tag and title, your level, league and stats (the rating's
// division is the duels' and Роял's, on their screens) — with
// its own places a tap away at the top (Награди, Гардероб, Алманах) and the settings beside your name.

import { emblem } from "../art/emblem.ts";
import { levelCard } from "../game/news.ts";
import { type Child, h, signal, when } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { user } from "../state.ts";
import {
  type AchievementInfo,
  avatar,
  badge,
  meter,
  profileHref,
  profileNav,
  rewardWords,
  type Unlock,
  unlockPicture,
  unlockWords,
} from "../ui.ts";
import { leagueCard } from "./league.ts";
import { loadProgress, type Progress } from "./progress.ts";
import { stats } from "./stats.ts";
import { yearLink } from "./year.ts";

export function me() {
  title("Профил");
  return h(
    "section",
    { class: "screen" },
    when(
      () => user(),
      () => {
        const progress = signal<Progress | null>(null);
        loadProgress().then(progress.set, () => {});
        return [
          profileNav(),
          head(progress),
          () => {
            const p = progress();
            return p ? levelCard(p.level, p.xp, p.from, p.to) : null;
          },
          () => {
            const p = progress();
            return p ? nextCard(p) : null;
          },
          leagueCard(),
          stats(),
          yearLink(),
          () =>
            user()?.tag
              ? h("a", { class: "link muted", href: profileHref(user()?.tag ?? "") }, "Как те виждат другите")
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

/** Who you are: your avatar (with its level), your name, the title you wear and your tag; and the settings. */
function head(progress: () => Progress | null): Child {
  return h(
    "div",
    { class: "me-head" },
    () => {
      const p = progress();
      return avatar(p?.avatar, {
        size: "l",
        level: p?.level,
        name: user.peek()?.name,
        frame: p?.frame,
        backdrop: p?.backdrop,
      });
    },
    h(
      "div",
      { class: "me-head-text" },
      h("h1", null, () => user()?.name ?? "Профил"),
      () => {
        const p = progress();
        const t = p?.title ? p.titles.find((a) => a.id === p.title) : undefined;
        return t ? h("span", { class: `me-title t-${t.tier}` }, t.name) : null;
      },
      () => (user()?.tag ? h("span", { class: "me-tag" }, `@${user()?.tag}`) : null),
    ),
    h(
      "a",
      { class: "icon-btn", href: "/settings", "aria-label": "Настройки", title: "Настройки" },
      h("span", { class: "i i-tune icon-btn-i", "aria-hidden": "true" }),
    ),
  );
}

/** What comes next, and what it brings: the next level that unlocks something, the division above, and the
 * achievements nearest — so that every way of playing shows where it leads. */
function nextCard(p: Progress): Child {
  const { next } = p;
  const near = nearest(p.achievements);
  if (!next.level && !next.division && !near.length) return null;
  const items = (list: Unlock[]) =>
    list.length
      ? h(
          "span",
          { class: "next-unlocks" },
          list.map((u) => h("span", { class: "next-unlock" }, unlockPicture(u, p.avatar), unlockWords(u))),
        )
      : null;
  return h(
    "section",
    { class: "card next" },
    h("h2", { class: "card-title" }, "Следва"),
    h(
      "ul",
      { class: "next-list" },
      next.level
        ? h(
            "li",
            { class: "next-row" },
            h("span", { class: "next-mark lv-mark num", "aria-hidden": "true" }, String(next.level)),
            h(
              "span",
              { class: "next-text" },
              h("strong", null, `Ниво ${next.level}`),
              h("span", { class: "muted" }, `още ${levelXP(next.level) - p.xp} XP`),
              items(next.levelUnlocks),
            ),
          )
        : null,
      next.division && p.standing.rated
        ? h(
            "li",
            { class: "next-row" },
            emblem(next.division.id, "m"),
            h(
              "span",
              { class: "next-text" },
              h("strong", null, `Дивизия ${next.division.name}`),
              h(
                "span",
                { class: "muted" },
                `при рейтинг ${next.division.from} (още ${next.division.from - p.standing.rating})`,
              ),
              items(next.divisionUnlocks),
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
            h("span", { class: "next-reward" }, rewardWords(a)),
          ),
        ),
      ),
    ),
    h("a", { class: "link", href: "/rewards" }, "Всички постижения"),
  );
}

/** The XP a level starts at (as the server's LevelOf: 300 for the first step, 150 more for each after). */
function levelXP(level: number): number {
  let from = 0;
  for (let l = 1, step = 300; l < level; l++, step += 150) from += step;
  return from;
}

/** The two achievements not yet earned nearest to done (of those that tell how far along they are first). */
function nearest(list: AchievementInfo[]): AchievementInfo[] {
  const share = (a: AchievementInfo) => (a.progress ?? 0) / (a.goal ?? 1);
  return list
    .filter((a) => !a.at && !a.hidden)
    .sort((a, b) => share(b) - share(a) || (a.goal ?? 1) - (b.goal ?? 1))
    .slice(0, 2);
}
