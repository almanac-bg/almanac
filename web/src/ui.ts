// The pieces several screens draw with: the verdict and the fact, the streak, numbers with what they count, and each
// topic's colour. The stylesheet draws them; these only say what to draw.

import { badgeArt } from "./art/badge.ts";
import { frameArt } from "./art/frame.ts";
import { type Child, h } from "./lib/dom.ts";
import { categories } from "./state.ts";

export type VerdictKind = "exact" | "right" | "partial" | "wrong" | "time";

const verdictWords: Record<VerdictKind, string> = {
  exact: "Точно!",
  right: "Вярно!",
  partial: "Близо.",
  wrong: "Не е това.",
  time: "Времето изтече.",
};

/** How an answer went: its sign, the word, and the points it brought (and how many of them for being quick). */
export function verdict(kind: VerdictKind, points: number, words = verdictWords[kind], speed = 0): Child {
  return h(
    "p",
    { class: `verdict ${kind}`, role: "status" },
    h("span", { class: "verdict-sign", "aria-hidden": "true" }),
    h("strong", { class: "verdict-word" }, words),
    points > 0
      ? h(
          "span",
          { class: "verdict-pts" },
          `+${points}`,
          speed > 0 ? h("small", { class: "verdict-speed" }, `${speed} за бързина`) : null,
        )
      : null,
  );
}

/** The fact behind an answer. */
export function fact(text: string): Child {
  return h("aside", { class: "fact" }, h("h2", null, "Знаеше ли?"), h("p", null, text));
}

const tones = ["gold", "lilac", "sky", "rose", "mint"];

/** A topic's colour, the same on every screen (by its place in the bank's list). */
export function toneOf(category: string): string {
  const i = Math.max(
    0,
    categories.findIndex((c) => c.id === category),
  );
  return `tone-${tones[i % tones.length]}`;
}

/** A thin bar, filled to percent. */
export function meter(percent: number, label: string): Child {
  return h(
    "span",
    { class: "meter", role: "img", "aria-label": label },
    h("i", { class: "meter-fill", style: { width: `${Math.max(0, Math.min(100, percent))}%` } }),
  );
}

/** A number and what it counts, in a card. */
export function stat(value: string, label: string, tone = ""): Child {
  return h(
    "div",
    { class: tone ? `stat ${tone}` : "stat" },
    h("b", { class: "stat-value" }, value),
    h("span", { class: "stat-label" }, label),
  );
}

/** A number and what it counts, bare (inside a card). */
export function figure(value: string, label: string): Child {
  return h(
    "div",
    { class: "figure" },
    h("b", { class: "figure-value" }, value),
    h("span", { class: "figure-label" }, label),
  );
}

const dayLetters = ["П", "В", "С", "Ч", "П", "С", "Н"];
const dayNames = ["понеделник", "вторник", "сряда", "четвъртък", "петък", "събота", "неделя"];
const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Sofia", weekday: "short" });

/** Today in Bulgaria, Monday first (0–6): the game's days are Bulgaria's. */
function today(): number {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday.format(new Date()));
}

/** The streak: days in a row with the day's ten, and this week's days played. */
export function streak(days: number, week?: boolean[]): Child {
  const unit = days === 1 ? "ден" : "дни";
  const now = today();
  return h(
    "section",
    { class: days ? "streak" : "streak cold", "aria-label": `Серия: ${days} ${unit}` },
    h("span", { class: "i flame", "aria-hidden": "true" }),
    h(
      "div",
      null,
      h(
        "div",
        { class: "streak-count" },
        h("b", { class: "streak-num" }, String(days)),
        h("span", { class: "streak-unit" }, unit),
      ),
      h("p", null, days ? "поред с въпросите на деня" : "Изиграй днешните и започни серия."),
    ),
    week?.length === 7
      ? h(
          "ol",
          { class: "week", "aria-label": "Тази седмица" },
          dayLetters.map((d, i) =>
            h(
              "li",
              {
                class: [week[i] && "on", i === now && "today"].filter(Boolean).join(" ") || undefined,
                "aria-label": `${dayNames[i]}${week[i] ? ": изиграно" : ""}`,
              },
              h("i", { class: "week-dot" }),
              d,
            ),
          ),
        )
      : null,
  );
}

/** A count of games, the way it's said: 1 игра, 2 игри. */
export const games = (n: number) => `${n} ${n === 1 ? "игра" : "игри"}`;
/** A count of questions: 1 въпрос, 2 въпроса. */
export const questions = (n: number) => `${n} ${n === 1 ? "въпрос" : "въпроса"}`;

/** How a player shows to others: their avatar (shape-tone), title and level. */
export interface Look {
  avatar?: string;
  title?: string;
  /** The tier of the achievement the title comes from: the title shows in its colour. */
  titleTier?: Tier;
  level?: number;
}

/** How hard an achievement is to earn, and so how rare its title. */
export type Tier = "common" | "rare" | "epic" | "legendary";

export const tiers: Tier[] = ["common", "rare", "epic", "legendary"];

/** A tier's words: for a group of achievements, for one achievement (neuter), and for a title (feminine). */
export const tierWords: Record<Tier, { group: string; one: string; title: string }> = {
  common: { group: "Обикновени", one: "обикновено", title: "Обикновена" },
  rare: { group: "Редки", one: "рядко", title: "Рядка" },
  epic: { group: "Епични", one: "епично", title: "Епична" },
  legendary: { group: "Легендарни", one: "легендарно", title: "Легендарна" },
};

export const shapeNames: Record<string, string> = {
  petal: "Венчелистче",
  rosette: "Розетка",
  circle: "Кръг",
  diamond: "Ромб",
  triangle: "Триъгълник",
  moon: "Луна",
  leaf: "Лист",
  wave: "Вълна",
  hex: "Шестоъгълник",
  flame: "Пламък",
  star: "Звезда",
  target: "Мишена",
  bolt: "Мълния",
  book: "Книга",
  trophy: "Купа",
  shield: "Щит",
  heart: "Сърце",
  eye: "Око",
  sun: "Слънце",
  hourglass: "Пясъчен часовник",
  spark: "Искра",
  clover: "Детелина",
  crown: "Корона",
};

export const toneNames: Record<string, string> = {
  gold: "злато",
  lilac: "люляк",
  sky: "небе",
  rose: "роза",
  mint: "мента",
};

const freeShapes = ["petal", "rosette", "circle", "diamond", "triangle", "moon", "leaf", "wave", "hex"];

/** An avatar for someone without one of their own: picked from their name, the same every time. */
function fromName(name: string): string {
  let n = 0;
  for (const c of name) n = (n * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return `${freeShapes[n % freeShapes.length]}-${tones[Math.floor(n / freeShapes.length) % tones.length]}`;
}

/** An avatar: a shape on a tone, with the level beside it when given. For the eye: the name and level are said in
 * words nearby. */
/** An avatar: a shape on a tone, and from the wardrobe a pattern behind it and a frame around it. `id` is
 * "shape-tone", or "shape-tone/frame/backdrop" as the server sends a look. */
export function avatar(
  id: string | undefined,
  opts: { size?: "s" | "l"; level?: number; name?: string; frame?: string; backdrop?: string } = {},
) {
  const [base = "", worn = "", pattern = ""] = (id || fromName(opts.name ?? "")).split("/");
  const [shape, tone] = base.split("-");
  const frame = opts.frame ?? worn;
  const backdrop = opts.backdrop ?? pattern;
  return h(
    "span",
    {
      class: ["avatar", opts.size, `av-${shape}`, `tone-${tone}`, backdrop && `bd-${backdrop}`, frame && "framed"]
        .filter(Boolean)
        .join(" "),
      "aria-hidden": "true",
    },
    frameArt(frame),
    opts.level ? h("b", { class: "lv" }, String(opts.level)) : null,
  );
}

/** Where a player's profile is: by their tag. */
export const profileHref = (tag: string) => `/players/${tag}`;

/** A player on a board or a list: their avatar, name and title; with their tag, a link to their profile. */
export function who(name: Child, look: Look = {}, extra: Child = null, plainName = "", tag = ""): Child {
  return h(
    tag ? "a" : "span",
    tag ? { class: "who", href: profileHref(tag) } : { class: "who" },
    avatar(look.avatar, { size: "s", level: look.level, name: plainName }),
    h(
      "span",
      { class: "who-text" },
      h("span", { class: "who-name" }, name, extra),
      look.title ? h("span", { class: `who-title t-${look.titleTier ?? "common"}` }, look.title) : null,
    ),
  );
}

/** An achievement: drawn as a medal of its tier with its shape, bright once earned. `about` says how it's earned;
 * `goal` and `progress` how far along it is; a hidden one not found yet comes without its name or how. */
export interface AchievementInfo {
  id: string;
  name: string;
  about: string;
  icon: string;
  tier: Tier;
  goal?: number;
  progress?: number;
  hidden?: boolean;
  at?: number;
}

export function badge(a: AchievementInfo, earned: boolean, size: "s" | "m" | "l" = "m"): HTMLElement {
  return badgeArt({
    tier: a.tier,
    icon: a.icon,
    earned,
    progress: a.goal ? (a.progress ?? 0) / a.goal : 0,
    size,
  });
}
