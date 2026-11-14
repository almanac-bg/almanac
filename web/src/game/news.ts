// What a game earned, said once, at its end, in three cards at most: the day's goals it finished (with their XP); the
// one biggest thing that happened (a week of the league ended, a division reached, a new level), or else a line of the XP it
// brought and the level; and „Ново за теб“: achievements and everything they unlocked to wear (each a tap from being
// worn), with how a topic's game moved its mastery. Only the biggest of it plays its sound.

import { emblem } from "../art/emblem.ts";
import { leagueEmblem } from "../art/league.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { place } from "../lib/ordinal.ts";
import { play, type SoundName } from "../lib/sound.ts";
import { type LeagueEnd, moveWords } from "../screens/league.ts";
import {
  type AchievementInfo,
  badge,
  type Division,
  meter,
  tierWords,
  type Unlock,
  unlockPicture,
  unlockWords,
} from "../ui.ts";
import { type MasteryMove, masteryLine } from "./mastery.ts";

interface News {
  achievements: AchievementInfo[];
  goals: { name: string; xp: number }[];
  /** How the player's last week in the league ended, not told yet. */
  league?: LeagueEnd;
  level: number;
  xp: number;
  from: number;
  to: number;
  levelUp?: boolean;
  /** The XP all this brought: the game just played, and the goals, achievements and week told with it. */
  earned: number;
  /** A division the rating has reached for the first time. */
  division?: Division;
  /** Everything newly unlocked to wear, whatever unlocked it. */
  unlocks: Unlock[];
  /** The avatar worn (shape-tone): an unlocked shape is put on in its tone. */
  avatar: string;
  /** How a topic's game moved its mastery. */
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
          const sound = loudest(n);
          if (sound) play(sound);
        },
        () => {},
      ),
    delay,
  );
  onCleanup(() => clearTimeout(t));
  return () => {
    const n = data();
    if (!n) return null;
    const top = headline(n);
    return [
      top === "level" ? null : xpLine(n),
      n.goals.length ? goalsDone(n.goals) : null,
      top === "league" && n.league ? leagueEnded(n.league) : null,
      top === "division" && n.division ? divisionReached(n.division) : null,
      top === "level" ? levelCard(n.level, n.xp, n.from, n.to, true, n.earned) : null,
      fresh(n),
    ];
  };
}

/** The one biggest thing a game's news holds, if any: a week of the league ended, then a division reached, then a
 * new level. */
function headline(n: News): "league" | "division" | "level" | null {
  if (n.league) return "league";
  if (n.division) return "division";
  if (n.levelUp) return "level";
  return null;
}

/** The sound of the biggest thing told: one, never a run of them. */
function loudest(n: News): SoundName | null {
  const top = headline(n);
  if (top === "level") return "level";
  if (top || n.achievements.length) return "achievement";
  if (n.goals.length) return "goal";
  return null;
}

/** The XP a game brought and the level it leaves, in a line (when no new level has a card of its own). */
function xpLine(n: News): Child {
  const level = `${n.levelUp ? "ново ниво" : "ниво"} ${n.level}`;
  return h(
    "p",
    { class: "news-xp" },
    n.earned > 0
      ? [h("b", { class: "num" }, `+${n.earned} XP`), ` · ${level}`]
      : level.charAt(0).toUpperCase() + level.slice(1),
  );
}

/** The level: its number, how far into it, and the XP left to the next (and, a new one, the XP that brought it). */
export function levelCard(level: number, xp: number, from: number, to: number, up = false, earned = 0): Child {
  const share = to > from ? Math.round((100 * (xp - from)) / (to - from)) : 0;
  return h(
    "section",
    { class: up ? "card level-card up" : "card level-card" },
    h(
      "div",
      { class: "level-head" },
      up ? h("p", { class: "kicker" }, "Ново ниво") : null,
      h("span", { class: "level-n" }, `Ниво ${level}`),
      h("span", { class: "muted" }, `${earned > 0 ? `+${earned} XP · ` : ""}още ${to - xp} XP до ниво ${level + 1}`),
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

/** A week of the league ended: the place in the group, where it takes the player, and the XP the place paid. */
function leagueEnded(e: LeagueEnd): Child {
  return h(
    "section",
    { class: `card unlock league-end lg-${e.now.tier}` },
    leagueEmblem(e.now.tier, "m"),
    h(
      "div",
      { class: "unlock-text" },
      h("p", { class: "kicker" }, "Седмицата в лигата свърши"),
      h("strong", null, `${place(e.place, e.of)} в ${e.from.name}`),
      h("span", { class: "unlock-reward" }, `${moveWords(e)}${e.xp ? ` · +${e.xp} XP` : ""}`),
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
      h("span", { class: "muted" }, `Рейтинг ${d.from} и нагоре.`),
    ),
  );
}

/** How many unlocks a game's news shows one by one. */
const shownUnlocks = 2;

/** „Ново за теб“: the achievements earned and everything unlocked to wear, in one list (each unlock a tap from being
 * worn), and how a topic's game moved its mastery, in a line. */
function fresh(n: News): Child {
  const mastery = masteryLine(n.mastery ?? []);
  if (!n.achievements.length && !n.unlocks.length && !mastery) return null;
  return h(
    "section",
    { class: "card unlocks" },
    h("p", { class: "kicker" }, "Ново за теб"),
    n.achievements.length || n.unlocks.length
      ? h(
          "ul",
          { class: "unlock-list" },
          n.achievements.map(earned),
          n.unlocks.slice(0, shownUnlocks).map((u) =>
            // What an achievement just told here unlocks needs no „С постижението …“: it's right above.
            unlockRow(
              u,
              n.avatar,
              n.achievements.some((a) => u.from.includes(`„${a.name}“`)),
            ),
          ),
        )
      : null,
    mastery,
    // A first game unlocks several things at once: two are told here, the rest wait in the wardrobe.
    n.unlocks.length > shownUnlocks
      ? h("a", { class: "link", href: "/wardrobe" }, `Още ${n.unlocks.length - shownUnlocks} в гардероба`)
      : n.unlocks.length
        ? h("a", { class: "link", href: "/wardrobe" }, "Към гардероба")
        : null,
  );
}

/** An achievement just earned: its medal, its name, its tier and its XP. */
function earned(a: AchievementInfo): Child {
  return h(
    "li",
    { class: `unlock-row achievement-row t-${a.tier}` },
    badge(a, true, "s"),
    h(
      "span",
      { class: "unlock-text" },
      h("strong", null, a.name),
      h("span", { class: "unlock-about" }, a.about),
      h("span", { class: "unlock-reward" }, `${cap(tierWords[a.tier].one)} постижение · +${a.xp ?? 0} XP`),
    ),
  );
}

/** Something just unlocked to wear, drawn, and a tap from being worn (`told`: what unlocked it is told already). */
function unlockRow(u: Unlock, worn: string, told = false): Child {
  return h(
    "li",
    { class: u.tier ? `unlock-row t-${u.tier}` : "unlock-row" },
    unlockPicture(u, worn),
    h(
      "span",
      { class: "unlock-text" },
      h("strong", { class: u.kind === "title" ? "unlock-title-name" : undefined }, cap(unlockWords(u))),
      told ? null : h("span", { class: "unlock-about" }, `С ${u.from}.`),
    ),
    wear(u, worn),
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
