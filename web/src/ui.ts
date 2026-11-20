// The pieces several screens draw with: the verdict and the fact, the streak, numbers with what they count, and each
// topic's colour. The stylesheet draws them; these only say what to draw.

import { picture } from "./art/picture.ts";
import { errorText, passing } from "./lib/api.ts";
import { hourInBulgaria } from "./lib/day.ts";
import { type Child, h, listen, onCleanup, signal } from "./lib/dom.ts";
import { type Scheme, scheme, setScheme } from "./lib/prefs.ts";
import { formatNumber, stakeWords } from "./lib/words.ts";
import { categories } from "./state.ts";

export { formatNumber };

export type VerdictKind = "exact" | "right" | "partial" | "wrong" | "time";

export const verdictWords: Record<VerdictKind, string> = {
  exact: "Точно!",
  right: "Вярно!",
  partial: "Близо.",
  wrong: "Не е това.",
  time: "Времето изтече.",
};

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

/** How an answer went: its sign, the word, and the right answers in a row it makes (the climb's feel only: a game's
 * score is its right answers). */
export function verdict(kind: VerdictKind, words = verdictWords[kind], inRow = 0): Child {
  return h(
    "div",
    { class: `verdict ${kind}`, role: "status" },
    h("span", { class: "verdict-sign", "aria-hidden": "true" }),
    h("div", { class: "verdict-says" }, h("strong", { class: "verdict-word" }, words), inRowChip(inRow)),
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
    ["device", "Автоматично"],
    ["night", "Нощ"],
    ["day", "Ден"],
  ];
  return segmented("Изглед", schemes, scheme, setScheme, false, true);
}

/** The fact behind an answer; over it, for a question of the day's ten dealt on its date, what happened that day
 * („На този ден“). Nothing when there's neither. `filed`: the chapter it went into, said under it (a right answer's
 * fact goes into the Алманах; a wrong one's waits for a right answer, and nothing says so). */
export function fact(text?: string, day?: string, filed?: string): Child {
  if (!text && !day) return null;
  return h(
    "aside",
    {
      class: day ? (text ? "fact dated" : "fact dated alone") : "fact",
      "aria-label": text ? "Знаеше ли?" : "На този ден",
    },
    day ? h("div", { class: "fact-day" }, h("h2", null, "На този ден"), h("p", null, day)) : null,
    text ? [h("h2", null, "Знаеше ли?"), h("p", null, text)] : null,
    text && filed
      ? h(
          "p",
          { class: "filed" },
          topicMark(filed),
          `Записано в Алманаха, глава „${categories.find((c) => c.id === filed)?.name ?? ""}“`,
        )
      : null,
  );
}

/** Asks for the facts' face (Literata, app.css) now. It loads only as text in it first shows, and an answer's panel
 * laid out before it came would change height when it did, after the answers had settled above it (game/run.ts,
 * settle): the right answer under the panel. A game asks for it as it starts, long before its first fact. */
export function factFace(): void {
  document.fonts?.load("italic 500 1rem Literata", "Знаеше ли?").catch(() => {});
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

/** A number and what it counts, in a card. */
export function stat(value: string, label: string, tone = ""): Child {
  return h(
    "div",
    { class: tone ? `stat ${tone}` : "stat" },
    h("b", { class: "stat-value" }, value),
    h("span", { class: "stat-label" }, label),
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
      opts.tag ? h("a", { href: profileHref(opts.tag) }, name) : name,
      opts.me ? h("span", { class: "rank-you" }, " ти") : null,
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

/** A day's score as a row says it: the right answers big, „от 10“ small beside them. */
export const rightsOf = (rights: number, of: number): Child => [
  h("b", { class: "rank-n" }, String(rights)),
  h("small", null, ` от ${of}`),
];

/** A player on a board or a list: their avatar and name; with their tag, a link to their profile. */
export function who(name: Child, look: Look = {}, extra: Child = null, plainName = "", tag = ""): Child {
  return h(
    tag ? "a" : "span",
    tag ? { class: "who", href: profileHref(tag) } : { class: "who" },
    avatar(look.avatar, { size: "s", name: plainName }),
    h(
      "span",
      { class: "who-text" },
      // The name gives way (an ellipsis) so that what's beside it („ти“) always shows whole.
      h("span", { class: "who-name" }, h("span", { class: "who-label" }, name), extra),
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
