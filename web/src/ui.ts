// The pieces several screens draw with: the verdict and the fact, the streak, numbers with what they count, and each
// topic's colour. The stylesheet draws them; these only say what to draw.

import { badgeArt } from "./art/badge.ts";
import type { DivisionID } from "./art/emblem.ts";
import { picture } from "./art/picture.ts";
import { type Child, h } from "./lib/dom.ts";
import { calm } from "./lib/prefs.ts";
import { path } from "./lib/router.ts";
import { categories } from "./state.ts";

export type VerdictKind = "exact" | "right" | "partial" | "wrong" | "time";

const verdictWords: Record<VerdictKind, string> = {
  exact: "Точно!",
  right: "Вярно!",
  partial: "Близо.",
  wrong: "Не е това.",
  time: "Времето изтече.",
};

/** A number as people write it in Bulgarian: a space between thousands from 10 000 up, a decimal comma. */
export function formatNumber(n: number, step = 1): string {
  const decimals = Math.max(0, (String(step).split(".")[1] ?? "").length);
  return new Intl.NumberFormat("bg", { maximumFractionDigits: decimals, useGrouping: Math.abs(n) >= 10000 }).format(n);
}

/** Points rising to `to` from `from`, once (at once where there's to be less motion); `prefix` goes before them. */
export function countUp(to: number, from = 0, prefix = ""): HTMLElement {
  const el = h("span", { class: "count-up" }, prefix + formatNumber(to));
  if (calm.peek() || to === from) return el;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / riseMs);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = prefix + formatNumber(Math.round((from + (to - from) * eased) / 10) * 10);
    if (t < 1) requestAnimationFrame(step);
  };
  el.textContent = prefix + formatNumber(from);
  requestAnimationFrame(step);
  return el;
}

/** How long points take to rise (DESIGN.md, Motion). */
const riseMs = 520;

/** Right answers in a row, from the second: the flame and how many. */
export function inRowChip(n: number): HTMLElement | null {
  if (n < 2) return null;
  return h(
    "span",
    { class: "in-row", "aria-label": `${n} верни отговора поред` },
    h("i", { class: "in-row-flame", "aria-hidden": "true" }),
    h("b", null, String(n)),
    " поред",
  );
}

/** How an answer went: its sign, the word, the right answers in a row it makes, and the points it brought (and how
 * many of them for being quick, and for the row). */
export function verdict(
  kind: VerdictKind,
  points: number,
  words = verdictWords[kind],
  speed = 0,
  row = 0,
  inRow = 0,
): Child {
  return h(
    "div",
    { class: `verdict ${kind}`, role: "status" },
    h("span", { class: "verdict-sign", "aria-hidden": "true" }),
    h("div", { class: "verdict-says" }, h("strong", { class: "verdict-word" }, words), inRowChip(inRow)),
    points > 0
      ? h(
          "span",
          { class: "verdict-pts" },
          countUp(points, 0, "+"),
          speed > 0 ? h("small", { class: "verdict-part" }, `${formatNumber(speed)} за бързина`) : null,
          row > 0 ? h("small", { class: "verdict-part row" }, `${formatNumber(row)} за ${inRow} поред`) : null,
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

/** A page's picture, over its heading (decoration): one of the ways to play, or "almanac", "friends". */
export function pageArt(id: string, tone: string): Child {
  return picture(`mode-${id}`, `page-art ${tone}`);
}

/** A topic's small picture, as on a chip (decoration); a plain dot for all of them. */
export function topicMark(category: string): Child {
  return category ? picture(`topic-${category}`, "topic-mark") : h("span", { class: "dot", "aria-hidden": "true" });
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

/** The streak: days in a row with the day's ten, this week's days played (and kept by a reserve day), and the reserve
 * days in hand. */
export function streak(days: number, week?: boolean[], saved?: boolean[], reserve = 0): Child {
  const unit = days === 1 ? "ден" : "дни";
  const now = today();
  return h(
    "section",
    { class: days ? "streak" : "streak cold", "aria-label": `Серия: ${days} ${unit}` },
    picture("flame", "flame"),
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
      h(
        "p",
        { class: "streak-reserve" },
        reserve
          ? `${reserveWords(reserve)}: ако пропуснеш ден, серията остава.`
          : "Изпълни и трите цели за деня и печелиш резервен ден за серията.",
      ),
    ),
    week?.length === 7
      ? h(
          "ol",
          { class: "week", "aria-label": "Тази седмица" },
          dayLetters.map((d, i) =>
            h(
              "li",
              {
                class:
                  [week[i] && "on", saved?.[i] && "saved", i === now && "today"].filter(Boolean).join(" ") || undefined,
                "aria-label": `${dayNames[i]}${week[i] ? ": изиграно" : saved?.[i] ? ": пазен с резервен ден" : ""}`,
              },
              h("i", { class: "week-dot" }),
              d,
            ),
          ),
        )
      : null,
  );
}

/** Reserve days, counted: 1 резервен ден, 2 резервни дни. */
export const reserveWords = (n: number) => (n === 1 ? "1 резервен ден" : `${n} резервни дни`);

/** A count of games, the way it's said: 1 игра, 2 игри. */
export const games = (n: number) => `${n} ${n === 1 ? "игра" : "игри"}`;
/** A count of questions: 1 въпрос, 2 въпроса. */
export const questions = (n: number) => `${n} ${n === 1 ? "въпрос" : "въпроса"}`;
/** Duels between two players, the way it's said: „2 победи, 1 загуба, 1 равенство“ (draws only when there are some). */
export const record = (won: number, lost: number, drawn: number) =>
  `${won} ${won === 1 ? "победа" : "победи"}, ${lost} ${lost === 1 ? "загуба" : "загуби"}` +
  (drawn ? `, ${drawn} ${drawn === 1 ? "равенство" : "равенства"}` : "");

/** How a player shows to others: their avatar (shape-tone), title and level. */
export interface Look {
  avatar?: string;
  title?: string;
  /** The title's tier: it shows in that tier's colour. */
  titleTier?: Tier;
  level?: number;
}

/** How hard an achievement or a title is to earn: a title shows in its tier's colour. */
export type Tier = "common" | "rare" | "epic" | "legendary";

export const tiers: Tier[] = ["common", "rare", "epic", "legendary"];

/** A tier's words: for a group of achievements, for one achievement (neuter), and for a title (feminine). */
export const tierWords: Record<Tier, { group: string; one: string; title: string }> = {
  common: { group: "Обикновени", one: "обикновено", title: "Обикновена" },
  rare: { group: "Редки", one: "рядко", title: "Рядка" },
  epic: { group: "Епични", one: "епично", title: "Епична" },
  legendary: { group: "Легендарни", one: "легендарно", title: "Легендарна" },
};

/** Every avatar's name: the animals everyone has, then the emblems achievements unlock. */
export const shapeNames: Record<string, string> = {
  fox: "Лисица",
  bear: "Мечка",
  cat: "Котка",
  hare: "Заек",
  hedgehog: "Таралеж",
  dog: "Куче",
  deer: "Елен",
  stork: "Щъркел",
  frog: "Жаба",
  flame: "Пламък",
  star: "Звезда",
  target: "Мишена",
  bolt: "Мълния",
  book: "Книга",
  trophy: "Купа",
  shield: "Щит",
  heart: "Сърце",
  owl: "Бухал",
  compass: "Компас",
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

const freeShapes = ["fox", "bear", "cat", "hare", "hedgehog", "dog", "deer", "stork", "frog"];

/** An avatar for someone without one of their own: picked from their name, the same every time. */
function fromName(name: string): string {
  let n = 0;
  for (const c of name) n = (n * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return `${freeShapes[n % freeShapes.length]}-${tones[Math.floor(n / freeShapes.length) % tones.length]}`;
}

/** An avatar: a picture on a tile of its tone, and from the wardrobe a pattern behind it and a frame around it, with
 * the level beside it when given. `id` is "shape-tone", or "shape-tone/frame/backdrop" as the server sends a look.
 * For the eye: the name and level are said in words nearby. */
export function avatar(
  id: string | undefined,
  opts: { size?: "s" | "l"; level?: number; name?: string; frame?: string; backdrop?: string } = {},
) {
  const [base = "", worn = "", pattern = ""] = (id || fromName(opts.name ?? "")).split("/");
  const [shape = "", tone] = base.split("-");
  const frame = opts.frame ?? worn;
  const backdrop = opts.backdrop ?? pattern;
  return h(
    "span",
    {
      class: ["avatar", opts.size, `tone-${tone}`, backdrop && `bd-${backdrop}`, frame && "framed"]
        .filter(Boolean)
        .join(" "),
      "aria-hidden": "true",
    },
    picture(shape, "avatar-pic"),
    frame ? picture(`frame-${frame}`, `avatar-frame fr-${frame}`) : null,
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
      // The name gives way (an ellipsis) so that what's beside it („ти“) always shows whole.
      h("span", { class: "who-name" }, h("span", { class: "who-label" }, name), extra),
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
  /** The XP it earns, once. */
  xp?: number;
  /** What else it gives: what it unlocks that the player doesn't have yet (once earned, what came with it). Not told
   * of a hidden one not yet found. */
  rewards?: Unlock[];
}

/** A band of rating, and where it starts. */
export interface Division {
  id: DivisionID;
  name: string;
  from: number;
}

/** Something to wear, unlocked (or to be): a title, a frame, a pattern or an avatar's shape, and what unlocks it. */
export interface Unlock {
  kind: "title" | "frame" | "backdrop" | "avatar";
  /** What to wear it by (an avatar's: its shape). */
  id: string;
  /** Its name ("" for an avatar: see `shapeNames`). */
  name: string;
  tier?: Tier;
  /** What unlocks it, as a phrase after „с“: „ниво 5“, „дивизия Злато“. */
  from: string;
}

/** What an unlock is, in a word, and its name: „титла „Оракул““, „рамка „Пламъци““. */
export function unlockWords(u: Unlock): string {
  const name = u.kind === "avatar" ? (shapeNames[u.id] ?? u.id) : u.name;
  const kind = { title: "титла", frame: "рамка", backdrop: "фон", avatar: "аватар" }[u.kind];
  return `${kind} „${name}“`;
}

/** An achievement's reward, said in a line: its XP and what it unlocks. */
export function rewardWords(a: AchievementInfo): string {
  const parts = [a.xp ? `+${a.xp} XP` : "", ...(a.rewards ?? []).map(unlockWords)].filter(Boolean);
  return parts.join(" · ");
}

/** An unlock drawn: an avatar's shape, a frame or a pattern on the player's own avatar (`worn`: shape-tone), or a
 * title in its tier's ink. */
export function unlockPicture(u: Unlock, worn: string): Child {
  const [, tone = "gold"] = worn.split("-");
  switch (u.kind) {
    case "avatar":
      return avatar(`${u.id}-${tone}`);
    case "frame":
      return avatar(worn, { frame: u.id });
    case "backdrop":
      return avatar(worn, { backdrop: u.id });
    default:
      return h("span", { class: `unlock-title-mark t-${u.tier ?? "common"}`, "aria-hidden": "true" });
  }
}

/** A title: its id (to wear it), its name, and its tier. */
export interface TitleRef {
  id: string;
  name: string;
  tier: Tier;
}

export function badge(a: AchievementInfo, earned: boolean, size: "s" | "m" | "l" = "m"): HTMLElement {
  return badgeArt({
    id: a.id,
    tier: a.tier,
    icon: a.icon,
    earned,
    progress: a.goal ? (a.progress ?? 0) / a.goal : 0,
    size,
  });
}

/** The way back to where a screen is reached from (a way to play, from Начало; Настройки, from Профил). */
export function back(href: string, label: string): Child {
  return h("a", { class: "back", href }, h("span", { class: "i i-left back-i", "aria-hidden": "true" }), label);
}

/** Профил's own places: the player at a glance, their rewards, their wardrobe, and their almanac. */
const profilePlaces: [href: string, label: string][] = [
  ["/me", "Общо"],
  ["/rewards", "Награди"],
  ["/wardrobe", "Гардероб"],
  ["/almanac", "Алманах"],
];

/** The switch between Профил's places, at the top of each. */
export function profileNav(): Child {
  return h(
    "nav",
    { class: "subnav", "aria-label": "Профил" },
    profilePlaces.map(([href, label]) =>
      h("a", { href, "aria-current": () => (path() === href ? "page" : null) }, label),
    ),
  );
}
