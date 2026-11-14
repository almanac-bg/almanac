// What a game earned, said once, at its end: the day's goals it finished (with their XP), a season ended (and what it
// paid), the level (and whether it went up), a division reached for the first time, how it moved the mastery of its
// topics, any achievement that came with it (with its XP), and — all together — everything these unlocked to wear,
// each a tap from being worn.

import { emblem } from "../art/emblem.ts";
import { seasonName } from "../art/season.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { place } from "../lib/ordinal.ts";
import { play } from "../lib/sound.ts";
import {
  type AchievementInfo,
  badge,
  type Division,
  meter,
  rewardWords,
  tierWords,
  type Unlock,
  unlockPicture,
  unlockWords,
} from "../ui.ts";
import { type MasteryMove, masteryMoves } from "./mastery.ts";

interface News {
  achievements: AchievementInfo[];
  goals: { name: string; xp: number }[];
  season?: { id: string; place: number; of: number; division: Division; xp: number };
  level: number;
  xp: number;
  from: number;
  to: number;
  levelUp?: boolean;
  /** A division the rating has reached for the first time. */
  division?: Division;
  /** Everything newly unlocked to wear, whatever unlocked it. */
  unlocks: Unlock[];
  /** The avatar worn (shape-tone): an unlocked shape is put on in its tone. */
  avatar: string;
  mastery?: MasteryMove[];
}

/** What a game earned, asked for once the game (run) is kept (after `delay`: a duel is kept a moment after it ends). */
export function news(run: number, delay = 0): Child {
  const data = signal<News | null>(null);
  const t = setTimeout(
    () =>
      api<News>("POST", "/api/me/news", { run }).then(
        (n) => {
          data.set(n);
          // In the order they show, each after the one before (and after the game's end).
          if (n.goals.length) play("goal");
          if (n.levelUp) play("level");
          if (n.achievements.length || n.division) play("achievement");
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
      n.season ? seasonEnded(n.season) : null,
      levelCard(n.level, n.xp, n.from, n.to, n.levelUp),
      n.division ? divisionReached(n.division) : null,
      masteryMoves(n.mastery ?? []),
      n.achievements.map(unlocked),
      n.unlocks.length ? unlocks(n.unlocks, n.avatar) : null,
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
      h("span", { class: "unlock-reward" }, rewardWords(a)),
    ),
  );
}

/** A season ended: the place, the division it ended in, and the XP that paid. */
function seasonEnded(s: NonNullable<News["season"]>): Child {
  return h(
    "section",
    { class: "card unlock season-end" },
    emblem(s.division.id, "m"),
    h(
      "div",
      { class: "unlock-text" },
      h("p", { class: "kicker" }, `Сезон ${seasonName(s.id)} свърши`),
      h("strong", null, `${place(s.place, s.of)} · ${s.division.name}`),
      h("span", { class: "unlock-reward" }, `+${s.xp} XP за дивизия ${s.division.name}`),
    ),
  );
}

/** A division the rating has reached for the first time. */
function divisionReached(d: Division): Child {
  return h(
    "section",
    { class: `card unlock d-${d.id}` },
    emblem(d.id, "m"),
    h(
      "div",
      { class: "unlock-text" },
      h("p", { class: "kicker" }, "Нова дивизия"),
      h("strong", null, d.name),
      h("span", { class: "muted" }, `Сезон, завършен в нея, носи +${d.xp} XP.`),
    ),
  );
}

/** Everything just unlocked to wear, each drawn and a tap from being worn. */
function unlocks(list: Unlock[], worn: string): Child {
  return h(
    "section",
    { class: "card unlocks" },
    h("p", { class: "kicker" }, list.length === 1 ? "Отключено" : `Отключени: ${list.length}`),
    h(
      "ul",
      { class: "unlock-list" },
      list.map((u) =>
        h(
          "li",
          { class: u.tier ? `unlock-row t-${u.tier}` : "unlock-row" },
          unlockPicture(u, worn),
          h(
            "span",
            { class: "unlock-text" },
            h("strong", { class: u.kind === "title" ? "unlock-title-name" : undefined }, cap(unlockWords(u))),
            h("span", { class: "muted" }, `С ${u.from}.`),
          ),
          wear(u, worn),
        ),
      ),
    ),
    h("a", { class: "link", href: "/wardrobe" }, "Към гардероба"),
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Puts an unlock on at once (an avatar's shape in the tone worn), and says so. */
function wear(u: Unlock, worn: string): Child {
  const done = signal(false);
  const error = signal("");
  const [, tone = "gold"] = worn.split("-");
  const body =
    u.kind === "avatar" ? { avatar: `${u.id}-${tone}` } : u.kind === "title" ? { title: u.id } : { [u.kind]: u.id };
  return [
    () =>
      done()
        ? h("span", { class: "muted", role: "status" }, "Сложено")
        : h(
            "button",
            {
              class: "btn inline",
              type: "button",
              "aria-label": `Сложи: ${unlockWords(u)}`,
              onclick: async () => {
                try {
                  await api("PATCH", "/api/me/look", body);
                  done.set(true);
                } catch (err) {
                  error.set((err as ApiError).message);
                }
              },
            },
            "Сложи",
          ),
    () => error() && h("span", { class: "bad" }, error()),
  ];
}
