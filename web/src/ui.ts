// The pieces several screens draw with: the verdict and the fact, the streak, numbers with what they count, and each
// chapter's colour. The stylesheet draws them; these only say what to draw.

import { picture } from "./art/picture.ts";
import type { Credit, Score } from "./game/types.ts";
import { errorText, passing } from "./lib/api.ts";
import { hourInBulgaria } from "./lib/day.ts";
import { type Child, h, listen, onCleanup, signal } from "./lib/dom.ts";
import { calm, type Scheme, scheme, setScheme } from "./lib/prefs.ts";
import { formatNumber, formatValue, found, hyphenate, keepNumbers, stakeWords } from "./lib/words.ts";
import { glyphBox, rankName, rankNames, sealParts } from "./seal.ts";
import { chapters, chaptersAndMix, user } from "./state.ts";

export { formatNumber, formatValue };

export type VerdictKind = "exact" | "right" | "partial" | "wrong" | "time";

/** The verdicts, a fixed set, never an answer's own words („Вярно“ is one of true-or-not's). */
export const verdictWords: Record<VerdictKind, string> = {
  exact: "Точно!",
  right: "Точно!",
  partial: "Близо, но не се брои.",
  wrong: "Не е това.",
  time: "Времето изтече.",
};

/** A verdict's words for a question of a kind (`type`): a number right but not spot on (near enough to count) is
 * „Вярно!“, never „Точно!“, which it isn't; no other kind is right without being exact, so „Вярно!“ never meets
 * true-or-not's answer. */
export function verdictSays(kind: VerdictKind, type?: string): string {
  return kind === "right" && type === "number" ? "Вярно!" : verdictWords[kind];
}

/** How an answer went: its sign and the word. Nothing counts a row of right answers: a game's score is its right
 * answers (DECISIONS.md, the closed list of nouns). */
export function verdict(kind: VerdictKind, words = verdictWords[kind]): Child {
  return h(
    "div",
    { class: `verdict ${kind}`, role: "status" },
    h("span", { class: "verdict-sign", "aria-hidden": "true" }),
    h("div", { class: "verdict-says" }, h("strong", { class: "verdict-word" }, words)),
  );
}

/** A segmented switch of a few choices: tabs that switch what a screen shows, or (`radio`) a setting to choose. */
export function segmented<T>(
  label: string,
  options: [T, Child][],
  now: () => T,
  choose: (v: T) => void,
  small = false,
  radio = false,
): Child {
  return h(
    "div",
    { class: small ? "segmented small" : "segmented", role: radio ? "radiogroup" : "tablist", "aria-label": label },
    options.map(([id, text]) =>
      h(
        "button",
        {
          type: "button",
          role: radio ? "radio" : "tab",
          [radio ? "aria-checked" : "aria-selected"]: () => now() === id,
          onclick: () => choose(id),
        },
        text,
      ),
    ),
  );
}

/** How the game looks on this device (prefs.ts: scheme): as the device is set, or Night or Day whatever it says. Not
 * „Тема“: in the game that's what questions are about. */
export function schemeSwitch(): Child {
  const schemes: [Scheme, string][] = [
    ["device", "Като устройството"],
    ["night", "Нощ"],
    ["day", "Ден"],
  ];
  return segmented("Изглед", schemes, scheme, setScheme, false, true);
}

/** The fact behind an answer; over it, for a question of the day's ten dealt on its date, what happened that day
 * („На този ден“). Nothing when there's neither. */
export function fact(text?: string, day?: string): Child {
  if (!text && !day) return null;
  return h(
    "aside",
    {
      class: day ? (text ? "fact dated" : "fact dated alone") : "fact",
      "aria-label": text ? "Знаеше ли?" : "На този ден",
    },
    day ? h("div", { class: "fact-day" }, h("h2", null, "На този ден"), h("p", null, textWords(day))) : null,
    text ? [h("h2", null, "Знаеше ли?"), h("p", null, textWords(text))] : null,
  );
}

/** Where a right answer in the issue wrote its fact in ink (play.Result.Ink): its chapter. Only ink is said: every
 * other fact met is in the book in grey, and nothing says so as it's met. */
export function filed(chapter: string): Child {
  return h(
    "p",
    { class: "filed" },
    h("span", { class: "i i-nib", "aria-hidden": "true" }),
    `Записано с мастило · тема „${chapterName(chapter)}“`,
  );
}

/** A chapter's name, as players read it ("history" → „История“; "mix" → „Всички теми“). */
export const chapterName = (chapter: string): string => chaptersAndMix.find((c) => c.id === chapter)?.name ?? "";

/** A chapter's glyph: its art on a white disc, `size` across (for the eye: its name is said beside it). */
export function glyph(chapter: string, size = 28, cls = ""): HTMLElement {
  return h(
    "span",
    {
      class: ["glyph", `ch-${chapter}`, cls].filter(Boolean).join(" "),
      style: { "--g": `${size}px` },
      "aria-hidden": "true",
    },
    picture(`chapter-${chapter}`),
  );
}

/** A chapter's name with its glyph, on a white pill: a question's chapter. */
export function chip(chapter: string, words: Child = chapterName(chapter)): HTMLElement {
  return h("span", { class: `chip ch-${chapter}` }, glyph(chapter), words);
}

/** A large sheet in a chapter's colour: a question, the day's score, a chapter's head. `fold`: its corner turned, the
 * next sheet's colour under it (`next`: its chapter; none, the page), as the issue's cover and the chapters' cards have
 * it, and nothing else does. */
export function leaf(chapter: string, parts: Child, cls = "", fold: { next?: string } | null = null): HTMLElement {
  const sheet = h(
    "div",
    { class: ["leaf", fold ? "folded" : "", `ch-${chapter}`, cls].filter(Boolean).join(" ") },
    parts,
    fold ? h("span", { class: "fold", "aria-hidden": "true" }) : null,
  );
  if (!fold) return sheet;
  return h(
    "div",
    { class: "leaf-wrap" },
    fold.next ? h("span", { class: `leaf-next ch-${fold.next}`, "aria-hidden": "true" }) : null,
    sheet,
  );
}

/** How one of the day's ten went, as a tile says it. */
export type TileState = "right" | "near" | "wrong" | "void" | "later";

const tileWords: Record<TileState, string> = {
  right: "вярно",
  near: "близо",
  wrong: "грешно",
  void: "не се брои",
  later: "предстои",
};

/** A mark's state as a tile (none yet: still to come). */
export const tileOf = (m?: { right: boolean; close?: boolean; void?: boolean }): TileState =>
  !m ? "later" : m.void ? "void" : m.right ? "right" : m.close ? "near" : "wrong";

/** The day's ten as tiles in their chapters' colours: right filled, близо half, wrong hollow, each with its glyph
 * (`chaptersOf`: the issue's, in its order). Read aloud as „3. История: вярно“. */
export function tiles(
  marks: { right: boolean; close?: boolean; void?: boolean }[],
  chaptersOf: string[],
  total = 10,
  label = "Как мина денят",
  open?: (n: number) => void,
): HTMLElement {
  return h(
    "ol",
    { class: "tiles", "aria-label": label },
    Array.from({ length: total }, (_, i) => {
      const chapter = chaptersOf[i] ?? "mix";
      const state = tileOf(marks[i]);
      const says = `${i + 1}. ${chapterName(chapter)}: ${tileWords[state]}`;
      // A way to its question gone over (a result's): the whole tile a button, which says what the tile does.
      const tap = open && marks[i];
      return h(
        "li",
        { class: `tile ${state} ch-${chapter}`, "aria-label": tap ? undefined : says },
        h("span", { class: "tile-pic" }, picture(`chapter-${chapter}`)),
        tap ? h("button", { class: "tile-tap", type: "button", "aria-label": says, onclick: () => open(i) }) : null,
      );
    }),
  );
}

/** A row's small shape of the day (a friend's, a board's): ten squares in ink, right filled, близо half. One picture,
 * read out in its words („1: вярно, 2: грешно…“): never a list, which can't be a picture. */
export function mini(marks: { right: boolean; close?: boolean; void?: boolean }[]): HTMLElement {
  const said = marks.map((m, i) => `${i + 1}: ${tileWords[tileOf(m)]}`).join(", ");
  return h(
    "span",
    { class: "mini", role: "img", "aria-label": said },
    marks.map((m) => h("i", { class: tileOf(m) === "near" ? "partial" : tileOf(m) })),
  );
}

const svgNS = "http://www.w3.org/2000/svg";

/** A chapter's seal (seal.ts): its rank as its silhouette, the chapter's glyph in its middle, `size` across (24 at the
 * least; from 32, Летопис's number past the first). Named for a screen reader: „История: Тетрадка“. */
export function seal(chapter: string, rank: number, size = 32, cls = ""): SVGSVGElement {
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("class", ["seal", `ch-${chapter}`, cls].filter(Boolean).join(" "));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${chapterName(chapter)}: ${rankName(rank)}`);
  for (const p of sealParts(rank)) {
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", p.d);
    path.setAttribute("class", [p.fill && `f-${p.fill}`, p.stroke && `s-${p.stroke}`].filter(Boolean).join(" "));
    if (p.width) path.setAttribute("stroke-width", String(p.width));
    svg.append(path);
  }
  const art = picture(`chapter-${chapter}`, `ch-${chapter}`);
  art.setAttribute("x", String(glyphBox.x));
  art.setAttribute("y", String(glyphBox.y));
  art.setAttribute("width", String(glyphBox.size));
  art.setAttribute("height", String(glyphBox.size));
  svg.append(art);
  // Летопис · 2 and on: its number on a tab at the corner, where it can be read.
  if (rank >= 7 && size >= 32) {
    const tab = document.createElementNS(svgNS, "rect");
    for (const [k, v] of Object.entries({ x: 29, y: 30, width: 18, height: 14, rx: 4, class: "seal-tab" }))
      tab.setAttribute(k, String(v));
    const n = document.createElementNS(svgNS, "text");
    for (const [k, v] of Object.entries({ x: 38, y: 41, "text-anchor": "middle", class: "seal-n" }))
      n.setAttribute(k, String(v));
    n.textContent = String(rank - 5);
    svg.append(tab, n);
  }
  return svg;
}

/** Where a chapter stands between two ranks (play.ChapterRank; play.Step): its rank (0 before any), its ink, the ink
 * its rank starts at and the ink the next one does. */
export interface Standing {
  chapter: string;
  level: number;
  ink: number;
  from: number;
  nextAt: number;
}

/** The ink still to come to the next rank: never 0 (the next rank, held for a day's count: play.StepOf). */
const leftOf = (s: Standing) => Math.max(1, s.nextAt - s.ink);

/** The steps of a chapter's way to its next rank, in ink, as its bar shows them: its way halved, and halved again at
 * its right end, until five or fewer are left, and those one ink each (5: 1, 1, 1, 1, 1; 15: 8, 4, 1, 1, 1; 250: 125, 63,
 * 31, 16, 8, 4, 1, 1, 1). So the bar is never more steps than an eye counts at a glance, and the last ones before a
 * rank are each a fact. */
export function stepsOf(way: number): number[] {
  const steps: number[] = [];
  let left = Math.max(1, way);
  while (left > 5) {
    const half = Math.ceil(left / 2);
    steps.push(half);
    left -= half;
  }
  for (; left > 0; left--) steps.push(1);
  return steps;
}

/** A chapter's bar as steps (stepsOf), each with how full it is, 0 to 1, and its share of the bar: the way is its ink
 * out of the next rank's (1 of 5, 40 of 100: never empty just past a rank); past Летопис, where each rank is a further
 * hundred, the ink within its hundred. Each step takes half the bar the one before it does, the last two alike (1/2,
 * 1/4, 1/8, 1/8): the big ones far from the rank, the small ones near it. Never the whole: the next rank isn't held
 * yet. */
export function barOf(s: Standing): { fill: number; share: number }[] {
  const start = s.level > rankNames.length ? s.from : 0;
  const steps = stepsOf(s.nextAt - start);
  let done = Math.max(0, s.nextAt - leftOf(s) - start);
  return steps.map((n, i) => {
    const fill = Math.min(1, done / n);
    done = Math.max(0, done - n);
    return { fill, share: 2 ** -Math.min(i + 1, steps.length - 1) };
  });
}

/** Where a chapter stands, in words: the rank it holds („Страница“, „Летопис · 2“; before a first, „Още без печат“),
 * and what's left to the next („още 8 до „Тетрадка““). */
export function standingWords(s: Standing): [now: string, next: string] {
  const next = rankName(s.level + 1).replaceAll(" ", " ");
  // Where it must break, between its halves: „още 8“, „до „Тетрадка““.
  return [s.level > 0 ? rankName(s.level) : "Още без печат", `още ${leftOf(s)} до „${next}“`];
}

/** Where a chapter stands, one way everywhere (Профил's seals, a chapter's head and card, the result's line): a bar in
 * the chapter's colour (in ink on its sheet) of steps filled for its ink out of the next rank's (barOf), so how many
 * are left shows without reading a number, and under it its two
 * ends named: the rank held at the left, in ink, and what's left to the next at the right. Where both don't fit on a
 * line, the right goes under the left, never cut; `named` false (a narrow card, its rank said over the bar), the right
 * one alone. The bar is for the eye: the words say it. */
export function standing(s: Standing, named = true): HTMLElement {
  const [now, next] = standingWords(s);
  return h(
    "span",
    { class: `standing ch-${s.chapter}` },
    h(
      "span",
      { class: "standing-bar", "aria-hidden": "true" },
      barOf(s).map(({ fill, share }) =>
        h(
          "span",
          { style: { "flex-grow": String(share) } },
          h("i", { style: { width: `${Math.round(fill * 1000) / 10}%` } }),
        ),
      ),
    ),
    h(
      "span",
      { class: "standing-words" },
      named ? h("b", { class: s.level > 0 ? "standing-now" : "standing-now none" }, now) : null,
      h("span", { class: "standing-next" }, next),
    ),
  );
}

/** A chapter's rank as Профил and a player's page have it (play.ChapterRank). */
export type ChapterRank = Standing;

/** A player's head, one look on Профил and on a player's page: the avatar (`face`: on Профил a button with „Смени“
 * under it), the name, the @username, the streak as it is now under them (`streak`: its days, „Играе от 11 дни без
 * прекъсване“ on another's page, „Играеш от …“ on one's own, `own`; nothing while there's none, never an ended one's,
 * DECISIONS.md). `why`, Профил's only: what the week forgives, said when the pointer rests on the streak (a phone has
 * it where a day missed is forgiven). */
export function profileHead(
  face: Child,
  name: Child,
  tag: string | (() => string | undefined),
  streak: () => number | undefined,
  why?: () => string | undefined,
  own = false,
): HTMLElement {
  const at = (t: string | undefined) => (t ? h("span", { class: "me-tag" }, `@${t}`) : null);
  return h(
    "div",
    { class: "me-head" },
    face,
    h(
      "div",
      { class: "me-who" },
      h("h1", null, name),
      h("p", { class: "me-ids" }, typeof tag === "function" ? () => at(tag()) : at(tag)),
      () => streakLine(streak(), why?.(), own),
    ),
  );
}

/** The streak in a player's head, a quiet line under the @username: „Играеш от 58 дни без прекъсване“ (one's own) or
 * „Играе от …“ (another's), its number heavy. Nothing while there's none. */
function streakLine(days: number | undefined, why: string | undefined, own: boolean): Child {
  if (!days) return null;
  return h(
    "p",
    { class: "me-line me-streak", title: why },
    own ? "Играеш от " : "Играе от ",
    h("b", { class: "num" }, formatNumber(days)),
    days === 1 ? " ден без прекъсване" : " дни без прекъсване",
  );
}

/** „Печати“, one section on Профил and on a player's page: the seals' list (sealList), or `none` before a first seal;
 * beside the heading the book's whole ink, the rows' summed („47 факта с мастило“; nothing at none). */
export function sealsSection(ranks: ChapterRank[], none: Child): HTMLElement {
  const had = sealsHad(ranks);
  const ink = had.reduce((n, r) => n + r.ink, 0);
  return h(
    "section",
    { class: "sect me-seals" },
    h(
      "div",
      { class: "sect-head" },
      h("h2", null, "Печати"),
      ink > 0
        ? h("span", { class: "sect-note seals-ink" }, `${formatNumber(ink)} ${ink === 1 ? "факт" : "факта"} с мастило`)
        : null,
    ),
    sealList(had) ?? none,
  );
}

/** The chapters with a rank, the most ink first (then in the bank's order: a stable sort keeps it). */
function sealsHad(ranks: ChapterRank[]): ChapterRank[] {
  return chapters
    .map((c) => ranks.find((r) => r.chapter === c.id))
    .filter((r): r is ChapterRank => !!r && r.level > 0)
    .sort((a, b) => b.ink - a.ink);
}

/** A player's seals, one list, a row a chapter with a rank, the most ink first (sealsHad): the seal (its glyph in
 * it); the chapter's name with its ink at the row's end; under them where it stands (standing: its bar, „Страница“
 * under its left end and „още 8 до „Тетрадка““ under its right). A view, never a choice. Nothing before a first seal:
 * the page says what brings one. */
function sealList(had: ChapterRank[]): Child {
  if (!had.length) return null;
  return h(
    "ul",
    { class: "seal-list" },
    had.map((r) => {
      // The seal for the eye: the words beside it say it.
      const s = seal(r.chapter, r.level, 40);
      s.removeAttribute("role");
      s.removeAttribute("aria-label");
      s.setAttribute("aria-hidden", "true");
      return h(
        "li",
        { class: `seal-row ch-${r.chapter}` },
        s,
        h(
          "span",
          { class: "seal-row-body" },
          // The name and the ink on a line while they fit; the ink under the name where they don't (large text).
          h(
            "span",
            { class: "seal-row-head" },
            h("b", { class: "seal-row-name" }, chapterName(r.chapter)),
            h(
              "span",
              { class: "seal-row-ink" },
              h("b", { class: "num" }, formatNumber(r.ink)),
              h("span", null, " с мастило"),
            ),
          ),
          standing(r),
        ),
      );
    }),
  );
}

/** The ladder of a chapter's ranks, Бележка to Летопис, each its seal and its name: the one reached (`rank`; Летопис
 * for „Летопис · 2“ and on, named so) ringed in ink and its name heavy, those below as they are, those to come faded.
 * On a rank-up and Профил. A narrow ladder names only the reached one, by its own width (app.css, a container
 * query); every seal stays. */
export function ladder(chapter: string, rank: number, size = 24): HTMLElement {
  const at = Math.min(rank, rankNames.length);
  return h(
    "ol",
    { class: `ladder ch-${chapter}`, "aria-label": `${chapterName(chapter)}: ${rankName(rank)}` },
    rankNames.map((name, i) => {
      const step = i + 1;
      return h(
        "li",
        { class: step < at ? "past" : step === at ? "now" : "later", "aria-current": step === at ? "step" : undefined },
        seal(chapter, step, size),
        h("span", { class: "ladder-name" }, step === at ? rankName(rank) : name),
      );
    }),
  );
}

const dayNames = ["понеделник", "вторник", "сряда", "четвъртък", "петък", "събота", "неделя"];
const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Sofia", weekday: "short" });

/** Today in Bulgaria, Monday first (0–6): the game's days are Bulgaria's. */
function today(): number {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday.format(new Date()));
}

const weekLetters = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

/** This week, a square a day, Monday first: a day played filled, today ringed in gold, the day the week forgave
 * marked, the days to come open. */
export function weekStrip(week?: boolean[], forgiven?: boolean[]): Child {
  if (week?.length !== 7) return null;
  const now = today();
  return h(
    "ol",
    { class: "week", "aria-label": "Тази седмица" },
    weekLetters.map((d, i) =>
      h(
        "li",
        {
          class:
            [week[i] && "on", forgiven?.[i] && "forgiven", i === now && "today", i > now && "later"]
              .filter(Boolean)
              .join(" ") || undefined,
          "aria-label": `${dayNames[i]}${week[i] ? ": изиграно" : forgiven?.[i] ? ": простен ден" : ""}`,
        },
        h("b", { class: "week-day" }, d),
        h("i", { class: "week-dot" }),
      ),
    ),
  );
}

/** A streak at stake while the day's ten wait (play/runs.go: it runs to yesterday until they're played), in a line
 * (stakeWords), read again each minute, so a screen left open turns to the evening's line: on the day's card and under
 * a chapter's result. */
export function stakeLine(days: number, spare: boolean): Child {
  if (days < 1) return null;
  const hour = signal(hourInBulgaria());
  const every = setInterval(() => hour.set(hourInBulgaria()), 60_000);
  onCleanup(() => clearInterval(every));
  return h("p", { class: "day-stake" }, () => stakeWords(days, spare, hour()));
}

/** A count of games, the way it's said: 1 игра, 2 игри. */
export const games = (n: number) => `${n} ${n === 1 ? "игра" : "игри"}`;
/** A count of questions: 1 въпрос, 2 въпроса. */
export const questions = (n: number) => `${n} ${n === 1 ? "въпрос" : "въпроса"}`;
/** Duels between two players, the way it's said: „2 победи, 1 загуба, 1 равенство“ (draws only when there are some). */
export const record = (won: number, lost: number, drawn: number) =>
  `${won} ${won === 1 ? "победа" : "победи"}, ${lost} ${lost === 1 ? "загуба" : "загуби"}` +
  (drawn ? `, ${drawn} ${drawn === 1 ? "равенство" : "равенства"}` : "");

/** How a player shows to others: their avatar (a shape). */
export interface Look {
  avatar?: string;
}

/** Every avatar's name: the animals, each anyone's to choose from the first day (play.Animals), in the order the
 * choice shows them. */
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
  mouse: "Мишка",
  squirrel: "Катерица",
  sheep: "Овца",
  turtle: "Костенурка",
  badger: "Язовец",
  lynx: "Рис",
};

const freeShapes = ["fox", "bear", "cat", "hare", "hedgehog", "dog", "deer", "stork", "frog"];

/** An avatar for someone without one of their own: picked from their name, the same every time. */
function fromName(name: string): string {
  let n = 0;
  for (const c of name) n = (n * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return freeShapes[n % freeShapes.length] ?? "fox";
}

/** An avatar: the drawn animal in its own colours, on a rounded tile of its scene (DECISIONS.md: an avatar is a face,
 * so an animal, in its own colours, and nothing on it: never a seal). `id` is the shape, as the server sends a look;
 * what isn't an animal is the one their name gives. The picture is for the eye (the name is said in words nearby). */
export function avatar(id: string | undefined, opts: { size?: "s" | "l"; name?: string } = {}) {
  const shape = id && Object.hasOwn(shapeNames, id) ? id : fromName(opts.name ?? "");
  return h(
    "span",
    // The shape's class gives it its colours and its scene's (app.css, .tone-natural).
    { class: ["avatar", opts.size, "tone-natural", `sh-${shape}`].filter(Boolean).join(" ") },
    h("span", { class: "avatar-tile", "aria-hidden": "true" }, picture(shape, "avatar-pic")),
  );
}

/** The mark: the rosette, four petals, the gold one up and to the left (web/public/favicon.svg, bare). */
export function rosette(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "5 5 54 54");
  svg.setAttribute("class", "rosette");
  svg.setAttribute("aria-hidden", "true");
  for (const turn of [-45, 45, 135, 225]) {
    const petal = document.createElementNS(ns, "path");
    petal.setAttribute("d", "M32 30.2C24.5 24.7 21.5 14.7 26 9.9c3.2-3.4 8.8-3.4 12 0 4.5 4.8 1.5 14.8-6 20.3z");
    petal.setAttribute("transform", `rotate(${turn} 32 32)`);
    petal.setAttribute("class", turn < 0 ? "petal gold" : "petal");
    svg.append(petal);
  }
  return svg;
}

/** Whether a tag is the player's own (tags are lower case on the server: account.NormalTag). */
export const isOwnTag = (tag: string) => !!tag && tag.toLowerCase() === user.peek()?.tag?.toLowerCase();

/** Where a player's profile is: by their tag; one's own is Профил, wherever it's named (a board, friends, a duel). */
export const profileHref = (tag: string) => (isOwnTag(tag) ? "/me" : `/players/${tag}`);

/** A day's score as a row says it (a friend's, a board's): the right answers in a heavy numeral, „от 10“ small beside
 * them, never parted from them. */
export const rightsOf = (rights: number, of: number): Child => [
  h("b", { class: "rank-n" }, String(rights)),
  h("small", null, ` от ${of}`),
];

const latinVowel = /[aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüý]/i;

/** Where a word in Latin letters (a player's name: „Maximilian“) may break, as soft hyphens, by hyphenate's rule for
 * Bulgarian (lib/words.ts): one consonant between two vowels goes to the next line, of more the last (two that make
 * one sound, „ch“, „sh“, „th“, „ph“, together), no line keeps or takes a single letter, and a word under seven
 * letters fits whole. Not a dictionary's breaks, but always at a syllable's edge, never at any letter. */
function latinSyllables(text: string): string {
  return text.replace(/\p{Script=Latin}{7,}/gu, (word) => {
    let out = "";
    let from = 0;
    let prev = -1;
    for (let i = 0; i < word.length; i++) {
      if (!latinVowel.test(word.charAt(i))) continue;
      if (prev >= 0 && i - prev > 1) {
        const cut = i - prev > 2 && /^[cstp]h$/i.test(word.slice(i - 2, i)) ? i - 2 : i - 1;
        if (cut - from >= 2 && word.length - cut >= 2) {
          out += `${word.slice(from, cut)}­`;
          from = cut;
        }
      }
      prev = i;
    }
    return out + word.slice(from);
  });
}

/** A word's syllables as soft hyphens, in either alphabet. */
const syllables = (word: string): string => latinSyllables(hyphenate(word));

/** A word that may break (seven letters and more, in either alphabet) held whole (`.whole-word`): it goes to the
 * next line whole where it fits there, and breaks at its syllables, with a hyphen, only where it's wider than its
 * line. */
const wholeWord = (word: string, find: string[] = []): Child => {
  const w = syllables(word);
  const shown = marked(w, find);
  return w === word ? shown : h("span", { class: "whole-word" }, shown);
};

/** A word with what a search found in it in a `<mark>` each (words.ts, found: across its soft hyphens). */
function marked(word: string, find: string[]): Child {
  const spans = found(word, find);
  if (!spans.length) return word;
  let at = 0;
  const out: Child[] = [];
  for (const [from, to] of spans) {
    out.push(word.slice(at, from), h("mark", null, word.slice(from, to)));
    at = to;
  }
  out.push(word.slice(at));
  return out;
}

/** A text as a narrow line holds it (a fact, an entry, outside the play screen; questions.ts, wholeWords, holds a
 * question's): it breaks between its words, a word only where it's wider than its line, at its syllables, with a
 * hyphen, never at any letter (large text at 320 px). With a search's words (`find`: words.ts, searchWords), what it
 * found marked: a search's word has no space in it, so a word of the text holds each match whole. */
export function textWords(text: string, find: string[] = []): Child {
  return keepNumbers(text)
    .split(/(\s+)/)
    .map((part, i) => (i % 2 ? part : wholeWord(part, find)));
}

/** Whose a picture is, and on what licence, each a link: „Снимка: Иван Иванов · CC BY-SA 4.0“. */
export function pictureCredit(c: Credit): Child {
  return h(
    "p",
    { class: "credit" },
    "Снимка: ",
    h("a", { href: c.source, target: "_blank", rel: "noopener" }, c.credit),
    " · ",
    c.licenseUrl ? h("a", { href: c.licenseUrl, target: "_blank", rel: "noopener" }, c.license) : c.license,
  );
}

/** A player's name as a line holds it (DESIGN.md, Names): it breaks between its words first, each word held whole,
 * going to the next line whole where it fits there; only a word wider than its line breaks, at its syllables, with a
 * hyphen (a surname too), in either alphabet („Maximi-lian“). A word that follows the name (`after`: „ти“, an
 * @username) stays with its last syllable, never alone on a line (`.name-end`).
 * CSS keeps `overflow-wrap: break-word` for a word no syllable can save (figures). */
export function nameWords(name: string, after: Child = null): Child {
  const words = name.trim().split(/\s+/);
  const lastWord = words.pop() ?? "";
  // What follows goes with the last word's last syllable: the word still breaks at its other syllables where it must,
  // and never runs past its line.
  const w = syllables(lastWord);
  const cut = w.lastIndexOf("­") + 1;
  const last =
    after == null || after === false || after === ""
      ? wholeWord(lastWord)
      : h("span", { class: "whole-word" }, w.slice(0, cut), h("span", { class: "name-end" }, w.slice(cut), after));
  // One span for the whole name: a link around it takes one rule, whatever its words (app.css, .name-words).
  return h("span", { class: "name-words" }, ...words.flatMap((x) => [wholeWord(x), " "]), last);
}

/** An email address as a narrow line holds it: broken after its @ or before a dot, never inside a word. */
export function emailWords(email: string): Child[] {
  return email.split(/(?<=@)|(?=\.)/).flatMap((part, i) => (i ? [h("wbr"), part] : [part]));
}

/** A player on a board or a list: their avatar and their name; with their tag, a link to their profile. */
export function who(name: Child, look: Look = {}, extra: Child = null, plainName = "", tag = ""): Child {
  return h(
    tag ? "a" : "span",
    tag ? { class: "who", href: profileHref(tag) } : { class: "who" },
    avatar(look.avatar, { size: "s", name: plainName }),
    h(
      "span",
      { class: "who-text" },
      // The name whole, never cut: what's beside it („ти“) after its last word.
      h(
        "span",
        { class: "who-name" },
        typeof name === "string"
          ? h("span", { class: "who-label" }, nameWords(name, extra))
          : [h("span", { class: "who-label" }, name), extra],
      ),
    ),
  );
}

/** A player's row, a friend's or a board's (Приятели's lists, Днес's friends): what comes before the avatar (a board's
 * place), the avatar, the name across the row (a way to their profile; on a second line rather than
 * cut), their day on a line under it, and what comes after (a friend's duel). */
export function playerRow(
  cls: string,
  look: { name: string; avatar?: string },
  tag: string | undefined,
  name: Child,
  day: Child,
  before: Child = null,
  after: Child = null,
): HTMLElement {
  return h(
    "li",
    { class: cls },
    before,
    avatar(look.avatar, { name: look.name }),
    h(
      "div",
      { class: "friend-text" },
      tag ? h("a", { class: "friend-name", href: profileHref(tag) }, name) : h("span", { class: "friend-name" }, name),
    ),
    h("span", { class: "friend-day" }, day),
    after,
  );
}

/** A day's row on a board (Приятели's, Днес's friends), built as a friend's (`playerRow`): its place before the
 * avatar (none on Днес, whose list leaves the player out, so places would skip), „ти“ after the player's own name
 * (their row washed), and under the name the score, the day's small squares after it (only where the server sends
 * them: once the viewer has finished the day). */
export const scoreRow = (s: Score, place: number | null, gap = false) =>
  playerRow(
    ["rank-row", s.me && "me", gap && "gap", place === null && "unplaced"].filter(Boolean).join(" "),
    s,
    s.tag,
    nameWords(s.name, s.me ? h("span", { class: "rank-you" }, " ти") : null),
    [h("span", { class: "rank-score" }, rightsOf(s.rights, s.of)), s.trail?.length ? mini(s.trail) : null],
    place === null ? null : h("span", { class: "rank-place" }, String(place)),
  );

/** A screen that couldn't load, never a dead end: what went wrong (lib/api.ts, errorText); „Опитай пак“ where trying
 * again can help, and the same by itself as the line comes back; and a way on (`way`: Днес, unless the screen is
 * Днес itself: null). */
export function failure(
  err: unknown,
  retry?: () => void,
  way: [href: string, label: string] | null = ["/", "Към Днес"],
): Child {
  const message = errorText(err);
  const again = retry && passing(err) ? retry : null;
  if (again) listen(window, "online", () => again(), { once: true });
  return h(
    "div",
    { class: "stack failure" },
    h("p", { role: "alert" }, message),
    again ? h("button", { class: "btn primary", type: "button", onclick: () => again() }, "Опитай пак") : null,
    way ? h("a", { class: again ? "btn" : "btn primary", href: way[0] }, way[1]) : null,
  );
}

/** What a tap brings up under it (an ask, an answer: „Нова връзка“'s, „Добави“'s, „Изтрий профила“'s), brought into
 * sight whole, clear of a phone's places at its foot (`.in-sight`'s scroll margin, their height): given as its `ref`.
 * Already in sight, it stays where it is. */
export function inSight(el: Element): void {
  el.classList.add("in-sight");
  requestAnimationFrame(() => el.scrollIntoView({ block: "nearest", behavior: calm.peek() ? "auto" : "smooth" }));
}

/** The way back to where a screen is reached from (a way to play, from Днес; Настройки, from Профил): back in the
 * history when that's the page before, else that page in place of this one (router.ts, leave), never a new entry. */
export function back(href: string, label: string): Child {
  return h(
    "a",
    { class: "back", href, "data-back": "" },
    h("span", { class: "i i-left back-i", "aria-hidden": "true" }),
    label,
  );
}
