// Профил: who you are in the game — your avatar, name, tag and title; your level and what comes next; your league in a
// line (its group is Класации'); your streak, numbers, mastery and latest games (the rating's division is the duels'
// and Роял's, on their screens) — with its own places a tap away at the top (Награди, Гардероб, Алманах) and the
// settings beside your name. A hub: each thing once, the whole of it a tap away.

import { emblem } from "../art/emblem.ts";
import { type Child, h, signal, when } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { user } from "../state.ts";
import {
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
import { leagueLine } from "./league.ts";
import { loadProgress, nearest, type Progress } from "./progress.ts";
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
            return p ? levelCard(p) : null;
          },
          leagueLine(),
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

/** The level, and what comes next: the XP to the next level and what the next that unlocks something brings, the
 * division above, and the two achievements nearest — so that every way of playing shows where it leads. */
function levelCard(p: Progress): Child {
  const { next } = p;
  const near = nearest(p.achievements, 2);
  const share = p.to > p.from ? Math.round((100 * (p.xp - p.from)) / (p.to - p.from)) : 0;
  const division = next.division && p.standing.rated ? next.division : undefined;
  const items = (list: Unlock[]) =>
    list.map((u) => h("span", { class: "next-unlock" }, unlockPicture(u, p.avatar), unlockWords(u)));
  return h(
    "section",
    { class: "card me-level" },
    h(
      "div",
      { class: "me-level-bar" },
      h(
        "div",
        { class: "level-head" },
        h("span", { class: "level-n" }, `Ниво ${p.level}`),
        h("span", { class: "muted" }, `още ${p.to - p.xp} XP до ниво ${p.level + 1}`),
      ),
      meter(share, `${share}% от ниво ${p.level}`),
    ),
    next.level && next.levelUnlocks.length
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
    division || near.length
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
        ]
      : null,
    h("a", { class: "link", href: "/rewards" }, "Всички постижения"),
  );
}

/** The XP a level starts at (as the server's LevelOf: 300 for the first step, 150 more for each after). */
function levelXP(level: number): number {
  let from = 0;
  for (let l = 1, step = 300; l < level; l++, step += 150) from += step;
  return from;
}
