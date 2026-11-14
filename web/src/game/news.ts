// What a game earned, said once, at its end: the day's goals it finished (with their XP), the level (and whether it
// went up), how it moved the mastery of its topics, any achievement that came with it, and any title these unlock,
// which may be worn at once.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { play } from "../lib/sound.ts";
import { type AchievementInfo, badge, meter, type TitleRef, tierWords } from "../ui.ts";
import { type MasteryMove, masteryMoves } from "./mastery.ts";

interface News {
  achievements: AchievementInfo[];
  goals: { name: string; xp: number }[];
  level: number;
  xp: number;
  from: number;
  to: number;
  levelUp?: boolean;
  /** The titles the levels just reached unlock. */
  titles?: TitleRef[];
  mastery?: MasteryMove[];
}

/** The level, a step up, the game's mastery and new achievements, asked for once the game (run) is kept (after
 * `delay`: a duel is kept a moment after it ends). */
export function news(run: number, delay = 0): Child {
  const data = signal<News | null>(null);
  const t = setTimeout(
    () =>
      api<News>("POST", "/api/me/news", { run }).then(
        (n) => {
          data.set(n);
          if (n.levelUp) play("level");
          if (n.achievements.length) setTimeout(() => play("achievement"), n.levelUp ? 700 : 0);
        },
        () => {},
      ),
    delay,
  );
  onCleanup(() => clearTimeout(t));
  return () => {
    const n = data();
    if (!n) return null;
    return [
      n.goals.length ? goalsDone(n.goals) : null,
      levelCard(n.level, n.xp, n.from, n.to, n.levelUp),
      (n.titles ?? []).map((t) => levelTitle(t, n.level)),
      masteryMoves(n.mastery ?? []),
      n.achievements.map(unlocked),
    ];
  };
}

/** The level: its number, how far into it, and the XP left to the next. */
export function levelCard(level: number, xp: number, from: number, to: number, up = false): Child {
  const share = to > from ? Math.round((100 * (xp - from)) / (to - from)) : 0;
  return h(
    "section",
    { class: up ? "card level-card up" : "card level-card" },
    h(
      "div",
      { class: "level-head" },
      up ? h("p", { class: "kicker" }, "Ново ниво") : null,
      h("span", { class: "level-n" }, `Ниво ${level}`),
      h("span", { class: "muted" }, `още ${to - xp} XP до ниво ${level + 1}`),
    ),
    meter(share, `${share}% от ниво ${level}`),
  );
}

/** The day's goals a game finished, and the XP they earned. */
function goalsDone(goals: News["goals"]): Child {
  return h(
    "section",
    { class: "card goals" },
    h("p", { class: "kicker" }, goals.length === 1 ? "Изпълнена цел" : "Изпълнени цели"),
    h(
      "ul",
      { class: "goal-list" },
      goals.map((g) =>
        h(
          "li",
          { class: "goal done fresh" },
          h("span", { class: "goal-mark", "aria-hidden": "true" }),
          h("span", { class: "goal-name" }, g.name),
          h("span", { class: "goal-xp num" }, `+${g.xp} XP`),
        ),
      ),
    ),
  );
}

function unlocked(a: AchievementInfo): Child {
  return h(
    "section",
    { class: `card unlock t-${a.tier}` },
    badge(a, true, "l"),
    h(
      "div",
      { class: "unlock-text" },
      h("p", { class: "kicker" }, `Ново ${tierWords[a.tier].one} постижение`),
      h("strong", null, a.name),
      h("span", { class: "muted" }, a.about),
      a.title ? titleLine(a.title) : null,
    ),
  );
}

/** A title a new level unlocks. */
function levelTitle(t: TitleRef, level: number): Child {
  return h(
    "section",
    { class: `card unlock t-${t.tier}` },
    h(
      "div",
      { class: "unlock-text" },
      h("p", { class: "kicker" }, `Нова ${tierWords[t.tier].title.toLowerCase()} титла`),
      h("strong", { class: "unlock-title-name" }, t.name),
      h("span", { class: "muted" }, `Идва с ниво ${level}.`),
      wearTitle(t),
    ),
  );
}

/** The title an achievement unlocks, and the way to wear it. */
function titleLine(t: TitleRef): Child {
  return [
    h("span", { class: "unlock-title" }, "Отключва титлата ", h("b", { class: `t-${t.tier}` }, `„${t.name}“`), "."),
    wearTitle(t),
  ];
}

/** Puts a title on at once, and says so. */
function wearTitle(t: TitleRef): Child {
  const worn = signal(false);
  const error = signal("");
  return [
    () =>
      worn()
        ? h("span", { class: "muted", role: "status" }, "Сега е под името ти.")
        : h(
            "button",
            {
              class: "link",
              type: "button",
              "aria-label": `Сложи титлата „${t.name}“`,
              onclick: async () => {
                try {
                  await api("PATCH", "/api/me/look", { title: t.id });
                  worn.set(true);
                } catch (err) {
                  error.set((err as ApiError).message);
                }
              },
            },
            "Сложи я",
          ),
    () => error() && h("span", { class: "bad" }, error()),
  ];
}
