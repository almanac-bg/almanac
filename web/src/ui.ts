// The pieces several screens draw with: the verdict and the fact, the streak, numbers with what they count, and each
// topic's colour. The stylesheet draws them; these only say what to draw.

import { picture } from "./art/picture.ts";
import type { Credit } from "./game/types.ts";
import { errorText, passing } from "./lib/api.ts";
import { hourInBulgaria } from "./lib/day.ts";
import { type Child, h, listen, onCleanup, signal } from "./lib/dom.ts";
import { calm, type Scheme, scheme, setScheme } from "./lib/prefs.ts";
import { formatNumber, formatValue, found, hyphenate, keepNumbers, stakeWords } from "./lib/words.ts";
import { glyphBox, rankName, rankNames, sealParts } from "./seal.ts";
import { topics } from "./state.ts";

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
  options: [T, string][],
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
export function filed(topic: string): Child {
  return h(
    "p",
    { class: "filed" },
    h("span", { class: "i i-nib", "aria-hidden": "true" }),
    `Записано с мастило · глава „${chapterName(topic)}“`,
  );
}

/** A box that may scroll on its own (the answer's panel docked at a run's foot, with a long fact: app.css): while it
 * does, the keyboard can reach it to scroll it, a stop of its own; while all of it shows, it's none. */
export function reachable(box: HTMLElement): void {
  const check = () => {
    if (box.scrollHeight > box.clientHeight + 1) box.tabIndex = 0;
    else box.removeAttribute("tabindex");
  };
  const sized = new ResizeObserver(check);
  sized.observe(box);
  onCleanup(() => sized.disconnect());
}

/** A topic's colour, the same on every screen: its chapter's (app.css, .t-<topic>). */
export function toneOf(category: string): string {
  return `t-${category}`;
}

/** A chapter's name, as players read it ("history" → „История“; „Микс“, „България“). */
export const chapterName = (topic: string): string => topics.find((c) => c.id === topic)?.name ?? "";

/** A chapter's glyph: its art on a white disc, `size` across (for the eye: its name is said beside it). */
export function glyph(topic: string, size = 28, cls = ""): HTMLElement {
  return h(
    "span",
    {
      class: ["glyph", `t-${topic}`, cls].filter(Boolean).join(" "),
      style: { "--g": `${size}px` },
      "aria-hidden": "true",
    },
    picture(`topic-${topic}`),
  );
}

/** A chapter's name with its glyph, on a white pill: a question's chapter. */
export function chip(topic: string, words: Child = chapterName(topic)): HTMLElement {
  return h("span", { class: `chip t-${topic}` }, glyph(topic), words);
}

/** A large sheet in a chapter's colour: a question, the day's entry, a chapter's head. `fold`: its corner turned, the
 * next sheet's colour under it (`next`: its topic; none, the page), as the issue's cover and the chapters' cards have
 * it, and nothing else does. */
export function leaf(topic: string, parts: Child, cls = "", fold: { next?: string } | null = null): HTMLElement {
  const sheet = h(
    "div",
    { class: ["leaf", fold ? "folded" : "", `t-${topic}`, cls].filter(Boolean).join(" ") },
    parts,
    fold ? h("span", { class: "fold", "aria-hidden": "true" }) : null,
  );
  if (!fold) return sheet;
  return h(
    "div",
    { class: "leaf-wrap" },
    fold.next ? h("span", { class: `leaf-next t-${fold.next}`, "aria-hidden": "true" }) : null,
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
 * (`topics`: the issue's, in its order). Read aloud as „3. История: вярно“. */
export function tiles(
  marks: { right: boolean; close?: boolean; void?: boolean }[],
  topicsOf: string[],
  total = 10,
  label = "Как мина денят",
): HTMLElement {
  return h(
    "ol",
    { class: "tiles", "aria-label": label },
    Array.from({ length: total }, (_, i) => {
      const topic = topicsOf[i] ?? "mix";
      const state = tileOf(marks[i]);
      return h(
        "li",
        { class: `tile ${state} t-${topic}`, "aria-label": `${i + 1}. ${chapterName(topic)}: ${tileWords[state]}` },
        h("span", { class: "tile-pic" }, picture(`topic-${topic}`)),
      );
    }),
  );
}

/** A row's small shape of the day (a friend's, a board's): ten squares in ink, right filled, близо half. */
export function mini(marks: { right: boolean; close?: boolean; void?: boolean }[]): HTMLElement {
  const said = marks.map((m, i) => `${i + 1}: ${tileWords[tileOf(m)]}`).join(", ");
  return h(
    "ol",
    { class: "mini", role: "img", "aria-label": said },
    marks.map((m) => h("li", { class: tileOf(m) === "near" ? "partial" : tileOf(m) })),
  );
}

const svgNS = "http://www.w3.org/2000/svg";

/** A chapter's seal (seal.ts): its rank as its silhouette, the chapter's glyph in its middle, `size` across (24 at the
 * least; from 32, Летопис's number past the first). Named for a screen reader: „История: Тетрадка“. */
export function seal(topic: string, rank: number, size = 32, cls = ""): SVGSVGElement {
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("class", ["seal", `t-${topic}`, cls].filter(Boolean).join(" "));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${chapterName(topic)}: ${rankName(rank)}`);
  for (const p of sealParts(rank)) {
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", p.d);
    path.setAttribute("class", [p.fill && `f-${p.fill}`, p.stroke && `s-${p.stroke}`].filter(Boolean).join(" "));
    if (p.width) path.setAttribute("stroke-width", String(p.width));
    svg.append(path);
  }
  const art = picture(`topic-${topic}`, `t-${topic}`);
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

/** How far a chapter has come towards its next rank: four pips under its seal, `quarters` (0–3) of them filled. For
 * the eye: the words beside it say how much ink is still to come. */
export function pips(quarters: number): HTMLElement {
  return h(
    "span",
    { class: "seal-pips", "aria-hidden": "true" },
    [0, 1, 2, 3].map((i) => h("i", { class: i < quarters ? "on" : undefined })),
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
    { class: `ladder t-${chapter}`, "aria-label": `${chapterName(chapter)}: ${rankName(rank)}` },
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

/** A player's worn seal, as it shows beside their name: none for a player without one. */
export interface Worn {
  chapter: string;
  level: number;
}

/** The seal a player wears, beside their name or on their avatar's corner, 24px (or `size`); nothing without one. Only
 * the seal: its rank's word is the Алманах's, never beside a name, nor read out there („Печат: История“). */
export function worn(w: Worn | null | undefined, size = 24): Child {
  if (!w?.chapter || w.level < 1) return null;
  const s = seal(w.chapter, w.level, size);
  s.setAttribute("aria-label", `Печат: ${chapterName(w.chapter)}`);
  return s;
}

/** A page's picture, over its heading (decoration): one of the ways to play, or "almanac", "friends". */
export function pageArt(id: string, tone: string): Child {
  return picture(`mode-${id}`, `page-art ${tone}`);
}

/** A topic's small picture, as on a chip (decoration), in the topic's own tone wherever it's put; a plain dot for all
 * of them. */
export function topicMark(category: string): Child {
  return category
    ? picture(`topic-${category}`, `topic-mark ${toneOf(category)}`)
    : h("span", { class: "dot", "aria-hidden": "true" });
}

let explained = 0;

/** A number's name (`label`) and what it means (`words`), in a small card by the word that comes out of it: shown
 * while a mouse is over the word (gone the moment it leaves) or the keyboard is on it; a tap keeps it until the next
 * one anywhere. */
export function explain(label: Child, words: string): Child {
  const id = `explain-${++explained}`;
  // A manual popover: the game says when it goes (WebKit's light dismiss closed it under the very tap that opened it).
  const pop = h("span", { class: "explain-pop", id, popover: "manual", role: "note" }, words) as HTMLElement;
  let kept = false;
  let mouse = false; // the last press was a mouse's: hovering already shows the card, a click only keeps it shown
  const shown = () => pop.matches(":popover-open");
  const show = () => {
    if (!shown()) pop.showPopover();
    // Under the word (over it if there's no room below), inside the screen's gutters, moving with the page.
    const at = word.getBoundingClientRect();
    const gutter = 16;
    const left = Math.min(
      Math.max(gutter, at.left + at.width / 2 - pop.offsetWidth / 2),
      innerWidth - pop.offsetWidth - gutter,
    );
    const below = at.bottom + 8;
    const above = below + pop.offsetHeight > innerHeight - gutter;
    const top = above ? at.top - 8 - pop.offsetHeight : below;
    pop.classList.toggle("above", above); // it comes out of the word: down from under it, up from over it
    pop.style.left = `${Math.max(gutter, left) + scrollX}px`;
    pop.style.top = `${Math.max(gutter, top) + scrollY}px`;
  };
  const hide = () => {
    if (shown() && !kept) pop.hidePopover();
  };
  // Kept by a tap, it goes with the next tap anywhere else, or Esc.
  const away = (e: Event) => {
    if (!pop.isConnected) {
      // Gone with its screen while open (no toggle then): nothing to put away, and no more listening.
      for (const type of ["pointerdown", "keydown"]) document.removeEventListener(type, away, true);
      return;
    }
    if (e instanceof KeyboardEvent ? e.key !== "Escape" : word.contains(e.target as Node)) return;
    kept = false;
    hide();
  };
  pop.addEventListener("toggle", () => {
    const open = shown();
    if (!open) kept = false;
    for (const type of ["pointerdown", "keydown"]) {
      if (open) document.addEventListener(type, away, true);
      else document.removeEventListener(type, away, true);
    }
  });
  const word = h(
    "button",
    {
      class: "explain",
      type: "button",
      "aria-describedby": id,
      onpointerenter: (e: PointerEvent) => e.pointerType === "mouse" && show(),
      onpointerleave: (e: PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        kept = false;
        hide();
      },
      onpointerdown: (e: PointerEvent) => {
        mouse = e.pointerType === "mouse";
      },
      onfocus: () => word.matches(":focus-visible") && show(),
      onblur: hide,
      onclick: () => {
        if (mouse) return show();
        // A tap or a key: the first keeps it, the next puts it away.
        if (shown() && kept) {
          kept = false;
          hide();
        } else {
          kept = true;
          show();
        }
      },
    },
    label,
  ) as HTMLElement;
  return [word, pop];
}

/** A thin bar, filled to percent. */
export function meter(percent: number, label: string): Child {
  return h(
    "span",
    { class: "meter", role: "img", "aria-label": label },
    h("i", { class: "meter-fill", style: { width: `${Math.max(0, Math.min(100, percent))}%` } }),
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
 * a topic's result. */
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

/** How a player shows to others: their avatar (shape-tone). */
export interface Look {
  avatar?: string;
  /** The seal they wear beside their name (play.Seal), if any. */
  seal?: Worn | null;
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

export const toneNames: Record<string, string> = {
  gold: "злато",
  lilac: "люляк",
  sky: "небе",
  rose: "роза",
  mint: "мента",
  natural: "естествени цветове",
};

const freeShapes = ["fox", "bear", "cat", "hare", "hedgehog", "dog", "deer", "stork", "frog"];

/** An avatar for someone without one of their own: picked from their name, the same every time. */
function fromName(name: string): string {
  let n = 0;
  for (const c of name) n = (n * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return freeShapes[n % freeShapes.length] ?? "fox";
}

/** An avatar: the drawn animal in its own colours, in a round medallion of its scene (DECISIONS.md: no tones). `id` is
 * "shape-tone", as the server sends a look; the tone a player chose before the edition is let be. For the eye: the
 * name is said in words nearby. */
export function avatar(id: string | undefined, opts: { size?: "s" | "l"; name?: string } = {}) {
  const shape = (id || fromName(opts.name ?? "")).split("-")[0] ?? "";
  // A chapter's art, the player's from the chapter's Страница: its glyph on a disc of its colour.
  if (topics.some((t) => t.id === shape))
    return h(
      "span",
      { class: ["avatar", "chart", opts.size, `t-${shape}`].filter(Boolean).join(" "), "aria-hidden": "true" },
      h("span", { class: "chart-disc" }, picture(`topic-${shape}`, "avatar-pic")),
    );
  return h(
    "span",
    {
      // The shape's class gives it its colours and its scene's (app.css, .tone-natural).
      class: ["avatar", opts.size, "tone-natural", `sh-${shape}`].filter(Boolean).join(" "),
      "aria-hidden": "true",
    },
    picture(shape, "avatar-pic"),
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

/** Where a player's profile is: by their tag. */
export const profileHref = (tag: string) => `/players/${tag}`;

/** A player's row on a board or a list, between hairlines (`.rows`): their place (if it has one), their avatar, their
 * name (a way to their profile, with their tag; „ти“ after the player's own, whose row is washed), and what's said of
 * them at its end: a score („8 от 10“), and a figure beside it (`aside`). */
export function rankRow(
  name: string,
  opts: { place?: number; me?: boolean; look?: Look; tag?: string; score?: Child; aside?: Child; gap?: boolean } = {},
): HTMLElement {
  return h(
    "li",
    { class: ["rank-row", opts.me && "me", opts.gap && "gap"].filter(Boolean).join(" ") },
    opts.place ? h("span", { class: "rank-place" }, String(opts.place)) : null,
    avatar(opts.look?.avatar, { name }),
    h(
      "span",
      { class: "rank-name" },
      // The seal and „ти“ after the name's last word (in its link): never alone on a line.
      opts.tag
        ? h("a", { href: profileHref(opts.tag) }, nameWords(name, worn(opts.look?.seal), opts.me ? rankYou() : null))
        : nameWords(name, worn(opts.look?.seal), opts.me ? rankYou() : null),
    ),
    opts.score || opts.aside
      ? h(
          "span",
          { class: "rank-end" },
          opts.score ? h("span", { class: "rank-score" }, opts.score) : null,
          opts.aside ? h("span", { class: "rank-aside" }, opts.aside) : null,
        )
      : null,
  );
}

/** „ти“ after the player's own name on a board. */
const rankYou = () => h("span", { class: "rank-you" }, " ти");

/** A day's score as a row says it: the right answers big, „от 10“ small beside them, never parted from them. */
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
 * hyphen (a surname too), in either alphabet („Maximi-lian“). What follows the name (`tail`: the seal worn, „ти“)
 * stays with its last word, never alone on a line (`.name-end`). CSS keeps `overflow-wrap: break-word` for a word no
 * syllable can save (figures). */
export function nameWords(name: string, ...tail: Child[]): Child {
  const words = name.trim().split(/\s+/);
  const lastWord = words.pop() ?? "";
  const after = tail.filter((t) => t != null && t !== false && t !== "");
  // What follows goes with the last word's last syllable: the word still breaks at its other syllables where it must,
  // and never runs past its line.
  const w = syllables(lastWord);
  const cut = w.lastIndexOf("­") + 1;
  const last = !after.length
    ? wholeWord(lastWord)
    : cut
      ? h("span", { class: "whole-word" }, w.slice(0, cut), h("span", { class: "name-end" }, w.slice(cut), ...after))
      : h("span", { class: "name-end" }, lastWord, ...after);
  // One span for the whole name: a link around it takes one rule, whatever its words (app.css, .name-words).
  return h("span", { class: "name-words" }, ...words.flatMap((x) => [wholeWord(x), " "]), last);
}

/** An email address as a narrow line holds it: broken after its @ or before a dot, never inside a word. */
export function emailWords(email: string): Child[] {
  return email.split(/(?<=@)|(?=\.)/).flatMap((part, i) => (i ? [h("wbr"), part] : [part]));
}

/** A player on a board or a list: their avatar and name; with their tag, a link to their profile. */
export function who(name: Child, look: Look = {}, extra: Child = null, plainName = "", tag = ""): Child {
  return h(
    tag ? "a" : "span",
    tag ? { class: "who", href: profileHref(tag) } : { class: "who" },
    avatar(look.avatar, { size: "s", name: plainName }),
    h(
      "span",
      { class: "who-text" },
      // The name whole, never cut: the seal (and what's beside it, „ти“) after its last word.
      h(
        "span",
        { class: "who-name" },
        typeof name === "string"
          ? h("span", { class: "who-label" }, nameWords(name, worn(look.seal), extra))
          : [h("span", { class: "who-label" }, name), worn(look.seal), extra],
      ),
    ),
  );
}

/** A screen that couldn't load, never a dead end: what went wrong (lib/api.ts, errorText); „Опитай пак“ where trying
 * again can help, and the same by itself as the line comes back; and a way on (`way`: Начало, unless the screen is
 * Начало itself: null). */
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

/** The way back to where a screen is reached from (a way to play, from Начало; Настройки, from Профил): back in the
 * history when that's the page before, else that page in place of this one (router.ts, leave), never a new entry. */
export function back(href: string, label: string): Child {
  return h(
    "a",
    { class: "back", href, "data-back": "" },
    h("span", { class: "i i-left back-i", "aria-hidden": "true" }),
    label,
  );
}
