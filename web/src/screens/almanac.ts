// Алманах, one of the three places: the player's book (DESIGN.md, Places). Its head — whose book it is, what ink and
// grey mean — then its chapters, each a card in its colour with its seal as the badge and its ink („22 с мастило“),
// in their numbers' order. A chapter (/almanac/<chapter>) is its head
// on its sheet (the seal, its ink, the rank and the way to the next), „Игра по тема“, and its facts, ink and grey, the
// latest first, a page at a time, found by their words. How well a player knows a chapter (mastery) is the game's own,
// never shown.

import type { Credit, Picture } from "../game/types.ts";
import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  api,
  lastOf,
  setIfNew,
  back,
  chapterName,
  failure,
  formatNumber,
  glyph,
  h,
  leaf,
  missing,
  nameWords,
  onCleanup,
  pictureCredit,
  textWords,
  standing,
  rename,
  seal,
  searchWords,
  signal,
  title,
  chapters,
  user,
} = {} as Kit;

/** A chapter's rank, as kept (play.ChapterRank): level 0 is none yet. */
interface Rank {
  chapter: string;
  level: number;
  name: string;
  /** The ink its rank starts at: past Летопис, its bar is the way from here to `nextAt` (ui.ts, wayOf). */
  from: number;
  ink: number;
  next: string;
  nextAt: number;
}

interface Learned {
  id: string;
  chapter: string;
  /** The question; none for a statement to judge, whose answer is the statement itself. */
  question?: string;
  answer: string;
  /** An answer of parts (an order, a match, a split): a line each, listed rather than set as one headword. */
  lines?: string[];
  /** A statement that isn't so: its answer is the statement, said untrue. */
  untrue?: boolean;
  fact: string;
  /** Written in ink (right in its issue, met there first), else in grey, as met (play/ink.go). */
  ink?: boolean;
  at: number;
  /** Where it was met: the day's ten (its issue), a chapter's game, a duel. */
  kind?: "day" | "chapter" | "duel";
  issue?: number;
  /** A picture question's picture (a choice of pictures', its answer's), as the play screen has it, and whose it is. */
  image?: Picture;
  credit?: Credit;
}

/** A page of the book (play.Almanac): its facts, how many the chapter (and the search) lists, each chapter's ink (its
 * one number: grey is listed, never counted); with the first page, each chapter's rank and the day the book began. */
interface Page {
  facts: Learned[];
  /** Which page this is, from 0: the one asked for, or the one that holds the fact asked for. */
  page?: number;
  found: number;
  ink: Record<string, number>;
  ranks?: Rank[];
  since?: string;
}

/** How many facts a page shows (play.AlmanacPage). */
const perPage = 30;

/** How many facts a chapter has before it offers to search them: fewer are read at a glance. */
const searchFrom = 10;

function setKit(kit: Kit) {
  ({
    api,
    lastOf,
    setIfNew,
    back,
    chapterName,
    failure,
    formatNumber,
    glyph,
    h,
    leaf,
    missing,
    nameWords,
    onCleanup,
    pictureCredit,
    textWords,
    standing,
    rename,
    seal,
    searchWords,
    signal,
    title,
    chapters,
    user,
  } = kit);
}

/** A chapter's game left unfinished today (play.Left): where it stopped. */
interface Left {
  chapter: string;
  at: number;
  total: number;
}

/** The book's chapters, in the bank's order. */
const chapterIds = () => chapters.map((t) => t.id);
const nameOf = (id: string) => chapterName(id) || id;

/** Алманах: the book's head, then its chapters. */
export function almanac(kit: Kit): Child {
  setKit(kit);
  title("Алманах");
  // Not a player yet: the book as it starts, its chapters each a way to play one.
  if (!user.peek()) return book({ facts: [], found: 0, ink: {} });
  // Come back to, the book as it was last shown, at once, and anew in place if it has changed (api.ts, lastOf).
  const page = signal<Page | null>(lastOf<Page>("/api/almanac") ?? null);
  const failed = signal<unknown>(null);
  // The games of a chapter left half-way today: each with the way to go on (a game's cross comes back here).
  const left = signal<Left[]>(lastOf<{ runs: Left[] }>("/api/runs/left")?.runs ?? []);
  api<{ runs: Left[] }>("GET", "/api/runs/left").then(
    (r) => setIfNew(left, r.runs),
    () => {},
  );
  const load = () => {
    failed.set(null);
    api<Page>("GET", "/api/almanac").then(
      (p) => setIfNew(page, p),
      (err) => {
        if (!page.peek()) failed.set(err);
      },
    );
  };
  load();
  return () => {
    const p = page();
    if (!p) return failed() ? failure(failed(), load) : h("p", { class: "muted" }, "…");
    return book(p, left);
  };
}

/** The book as a page: its head (with a game left half-way today, the way to go on), and its chapters, the one
 * in their numbers' order. */
function book(p: Page, left: () => Left[] = () => []): Child {
  const name = user.peek()?.name;
  const rankOf = (id: string) => p.ranks?.find((r) => r.chapter === id);
  // The chapters in their numbers' order (Глава 1, 2, …), always the same: a book's contents, never resorted. A row's
  // cards are as tall as its tallest, so a card with no ink yet leaves no hole beside an inked one.
  const order = chapters.map((c) => c.id);
  return h(
    "section",
    { class: "screen book" },
    h(
      "header",
      { class: "book-head" },
      h("h1", null, name ? ["Алманахът на ", nameWords(name)] : "Алманахът ти"),
      h(
        "p",
        { class: "deck" },
        // At zero, said once here, not on each chapter.
        Object.values(p.ink).some(Boolean)
          ? "С мастило са фактите от верните ти отговори в броя на деня. Всички други, които срещнеш, са в сиво."
          : "Всеки верен отговор в броя на деня вписва един факт с мастило в твоя Алманах.",
      ),
      () =>
        left().map((l) =>
          h(
            "p",
            { class: `book-left ch-${l.chapter}` },
            glyph(l.chapter, 32),
            h(
              "span",
              { class: "book-left-words" },
              h("b", null, nameOf(l.chapter)),
              `Следва въпрос ${l.at + 1}\u00a0от\u00a0${l.total}.`,
            ),
            h("a", { class: "btn inline", href: `/play/${l.chapter}` }, "Продължи"),
          ),
        ),
    ),
    h(
      "ol",
      { class: "chapters", "aria-label": "Главите" },
      order.map((id) => h("li", null, card(id, p.ink[id] ?? 0, rankOf(id)))),
    ),
  );
}

/** A chapter's card: its colour, its seal as the badge (or its glyph, before a rank) over its name, its ink, and its
 * rank over its bar, and under the bar what's left to the next („Тетрадка“, the bar, „още 15 до „Книга““: ui.ts,
 * standing; before a rank, „Още без печат“, the bar empty, „още 1 до „Бележка““). The corner turned, as a page of the
 * book. */
function card(id: string, ink: number, r: Rank | undefined): Child {
  // The rank as counted when the last issue was over, what's left to the next from the ink shown (written answer by
  // answer, an issue under way too), as Профил has it.
  const ranked = r && r.level > 0 ? { ...r, ink } : null;
  // Before its first rank, the same foot: „Още без печат“ over an empty bar, and what's left to „Бележка“ under it.
  const way = ranked ?? { chapter: id, level: 0, ink, from: 0, nextAt: r?.nextAt || 1 };
  return h(
    "a",
    { class: "chapter-card", href: `/almanac/${id}` },
    leaf(
      id,
      [
        h(
          "span",
          { class: "card-top" },
          ranked ? seal(id, ranked.level, 40) : glyph(id, 40),
          h("span", { class: "card-name" }, nameOf(id)),
        ),
        // A counter at zero is hidden: the book's head says once how ink is written.
        ink
          ? h("span", { class: "card-ink" }, h("b", { class: "num" }, formatNumber(ink)), h("span", null, "с мастило"))
          : null,
        // A card is too narrow for both ends' words under the bar: the rank goes over it, what's left under it.
        h(
          "span",
          { class: "card-rank" },
          ranked ? h("b", null, ranked.name) : h("b", { class: "none" }, "Още без печат"),
          standing(way, false),
        ),
      ],
      "card-leaf",
      { next: "" },
    ),
  );
}

const shortMonths = ["ян.", "февр.", "март", "апр.", "май", "юни", "юли", "авг.", "септ.", "окт.", "ноем.", "дек."];

/** A day as an entry dates it: „19 ноем.“ */
function shortDate(day: string): string {
  const [, m = 1, d = 1] = day.split("-").map(Number);
  return `${d} ${shortMonths[m - 1]}`;
}

/** A chapter of the book (/almanac/<chapter>): its head on its sheet, „Игра по тема“, and its facts as entries, the
 * latest first, a page at a time, found by their words. Its page and search are in the address (?page=2&q=…), so back
 * to it, or a reload, opens the same. Opened at facts (?fact=<id>, one for each: the day's result's, of the facts the
 * day wrote), it opens on the page that holds them, the first of them in sight, each tinted in the chapter's colour
 * for a moment (app.css, .lit); they're read from the address once, and it becomes the page's own. */
export function chapter(kit: Kit, [id = ""]: string[]): Child {
  setKit(kit);
  // A chapter the book doesn't have: the page that isn't there, not an empty chapter by that name.
  if (!chapterIds().includes(id)) return missing();
  const name = nameOf(id);
  // Come to by a turn of this chapter's pages: the facts stay in sight once they're in.
  let toFacts = turned;
  turned = false;
  title(name);
  const at = new URLSearchParams(location.search);
  // The facts to open at, and mark: the latest of them (the last named) is the highest on its page.
  let marked = at.getAll("fact");
  const page = signal(Math.max(0, (Number(at.get("page")) || 1) - 1));
  const query = signal(at.get("q") ?? "");
  // Come back to (not to facts to mark), the chapter as it was last shown, at once, and anew in place if it has changed
  // (api.ts, lastOf).
  const opening = new URLSearchParams({ chapter: id, page: String(page.peek()) });
  if (query.peek().trim()) opening.set("q", query.peek().trim());
  const before = marked.length ? undefined : lastOf<Page>(`/api/almanac?${opening}`);
  const data = signal<Page | null>(before ?? null);
  const first = signal<Page | null>(
    before?.ranks ? before : (lastOf<Page>(`/api/almanac?${new URLSearchParams({ chapter: id })}`) ?? null),
  );
  const failed = signal<unknown>(null);
  // The chapter's facts in all, unsearched: the search shows from `searchFrom` of them.
  const total = signal(first.peek()?.found ?? 0);
  let asked = "";
  // The words the page shown was found by, marked in its entries (none unsearched).
  let find: string[] = [];
  /** The chapter's first page, which has its rank: asked for apart when the chapter opens on another. */
  const loadFirst = () =>
    api<Page>("GET", `/api/almanac?${new URLSearchParams({ chapter: id })}`).then(
      (p) => {
        setIfNew(first, p);
        total.set(p.found);
      },
      () => {},
    );
  /** The address as the chapter shows now: its page and its search, so that back to it opens it as it was. */
  const named = () => {
    const shown = new URLSearchParams();
    if (page.peek()) shown.set("page", String(page.peek() + 1));
    if (query.peek().trim()) shown.set("q", query.peek().trim());
    rename(`/almanac/${id}${shown.toString() ? `?${shown}` : ""}`);
  };
  const load = () => {
    const q = new URLSearchParams({ chapter: id, page: String(page.peek()) });
    if (query.peek().trim()) q.set("q", query.peek().trim());
    // Opened at facts: the page that holds the latest of them, whichever it is (play.AlmanacQuery.Fact).
    const mark = marked;
    marked = [];
    if (mark.length) q.set("fact", mark.at(-1) ?? "");
    const ask = q.toString();
    asked = ask;
    failed.set(null);
    api<Page>("GET", `/api/almanac?${ask}`).then(
      (p) => {
        if (asked !== ask) return; // an older answer, come late
        // A page past the last (an old link, a number typed in): the last page, in its place.
        const last = Math.max(0, Math.ceil(p.found / perPage) - 1);
        if (!p.facts.length && page.peek() > last) {
          page.set(last);
          load();
          return;
        }
        find = searchWords(q.get("q") ?? "");
        if (mark.length && p.page) {
          page.set(p.page);
          named();
          void loadFirst();
        }
        setIfNew(data, p);
        if (p.ranks) setIfNew(first, p);
        if (!ask.includes("q=")) total.set(p.found);
        if (toFacts) requestAnimationFrame(() => document.querySelector(".chapter-facts")?.scrollIntoView());
        toFacts = false;
        // The facts asked for, once they're drawn: marked, the first of them in sight.
        if (mark.length)
          requestAnimationFrame(() => {
            const lit = [...document.querySelectorAll<HTMLElement>(".entry[data-fact]")].filter((e) =>
              mark.includes(e.dataset.fact ?? ""),
            );
            for (const e of lit) e.classList.add("lit");
            lit[0]?.scrollIntoView({ block: "center" });
          });
      },
      (err) => {
        if (asked === ask) failed.set(err);
      },
    );
    named();
  };
  if (user.peek()) {
    // The first page has the chapter's rank: asked for once, apart, when the chapter opens on another page.
    if (page.peek() || query.peek()) void loadFirst();
    load();
  }
  // The chapter's game left half-way today: it goes on from where it stopped (play.Left).
  const left = signal<{ at: number; total: number } | null>(
    lastOf<{ runs: Left[] }>("/api/runs/left")?.runs.find((x) => x.chapter === id) ?? null,
  );
  if (user.peek())
    api<{ runs: Left[] }>("GET", "/api/runs/left").then(
      (r) => setIfNew(left, r.runs.find((x) => x.chapter === id) ?? null),
      () => {},
    );
  let typing = 0;
  onCleanup(() => clearTimeout(typing));
  const search = (text: string) => {
    query.set(text);
    clearTimeout(typing);
    typing = window.setTimeout(() => {
      page.set(0);
      load();
    }, 300);
  };
  // Each page of the chapter is an entry of the history: back from page 3 comes to page 2, not out of the chapter.
  const pageHref = (to: number) => {
    const shown = new URLSearchParams();
    if (to) shown.set("page", String(to + 1));
    if (query.peek().trim()) shown.set("q", query.peek().trim());
    return `/almanac/${id}${shown.toString() ? `?${shown}` : ""}`;
  };
  const index = chapterIds().indexOf(id);
  const finder = user.peek()
    ? h(
        "label",
        { class: "search" },
        h("span", { class: "i i-search", "aria-hidden": "true" }),
        h("input", {
          type: "search",
          "aria-label": "Търси във фактите",
          placeholder: "Търси факт",
          maxlength: 60,
          autocomplete: "off",
          enterkeyhint: "search",
          value: query,
          oninput: (e: Event) => search((e.target as HTMLInputElement).value),
        }),
      )
    : null;
  return h(
    "section",
    { class: `screen chapter spread ch-${id}` },
    h(
      "div",
      { class: "chapter-side page-1" },
      back("/almanac", "Алманах"),
      leaf(
        id,
        [
          h(
            "header",
            { class: "chapter-head" },
            h("span", { class: "chapter-art" }, glyph(id, 72)),
            h(
              "div",
              { class: "chapter-title" },
              h("p", { class: "kicker" }, `Глава ${index + 1}`),
              h("h1", null, name),
            ),
          ),
          // Nothing of where it stands until its numbers have come: drawn before them, it said „no ink yet“ for a moment,
          // right after a day's „+1 с мастило“ led here.
          () => {
            const f = first();
            return f || !user.peek()
              ? stand(
                  id,
                  f?.ranks?.find((r) => r.chapter === id),
                  f?.ink[id] ?? 0,
                )
              : null;
          },
        ],
        "chapter-leaf",
      ),
      h(
        "div",
        { class: "chapter-play" },
        h("a", { class: "btn primary", href: `/play/${id}` }, () => (left() ? "Продължи играта" : "Играй 10 въпроса")),
        () => {
          const l = left();
          return l ? h("p", { class: "small" }, `Следва въпрос ${l.at + 1}\u00a0от\u00a0${l.total}.`) : null;
        },
      ),
    ),
    h(
      "section",
      { class: "sect chapter-facts page-2" },
      h("div", { class: "sect-head" }, h("h2", null, "Фактите"), () => {
        const p = data();
        // A count at zero is hidden (DESIGN.md, Copy); one fact has no order to name.
        return p && (p.found > 0 || query().trim())
          ? h(
              "span",
              { class: "sect-note" },
              query().trim()
                ? `намерени: ${formatNumber(p.found)}`
                : p.found === 1
                  ? "1\u00a0факт"
                  : `${formatNumber(p.found)}\u00a0факта, най-новите първи`,
            )
          : null;
      }),
      // The search, once the chapter has facts enough to look through (or comes searched).
      () => (finder && (total() >= searchFrom || query.peek().trim()) ? finder : null),
      (): Child => {
        if (!user())
          return h("p", { class: "entries-none" }, "Изиграй първите си въпроси и фактите им ще се записват тук.");
        const p = data();
        if (!p) return failed() ? failure(failed(), load, null) : h("p", { class: "muted" }, "…");
        if (!p.facts.length)
          return h(
            "p",
            { class: "entries-none" },
            query().trim()
              ? "Нищо не е намерено. Опитай с друга дума."
              : "Тук още няма факти. Всеки въпрос от тази тема, който срещнеш, записва тук своя факт.",
          );
        // What ink and grey are is said once, at the book's head, not again over each chapter's facts (each entry
        // says which it is on its chip).
        return [
          h(
            "ol",
            { class: "entries" },
            p.facts.map((f) => entry(f, find)),
          ),
          pager(page(), Math.ceil(p.found / perPage), pageHref),
        ];
      },
    ),
  );
}

/** Where a chapter stands: its seal beside its ink (the book's, as its card shows it), and under them, as wide as the
 * head, its bar with the rank under its left end and the ink still to come under its right (ui.ts, standing). Before a
 * rank, what writes its first: a right answer in the day's issue. */
function stand(id: string, r: Rank | undefined, ink: number): Child {
  const ranked = r && r.level > 0 ? { ...r, ink } : null; // what's left counted from the ink shown (card)
  return h(
    "div",
    { class: "chapter-stand" },
    ranked ? h("span", { class: "chapter-seal" }, seal(id, ranked.level, 64, "rimmed")) : null,
    h(
      "div",
      { class: "chapter-words" },
      ink ? h("p", { class: "chapter-ink" }, h("b", { class: "num" }, formatNumber(ink)), " с мастило") : null,
      ranked ? null : h("p", { class: "chapter-next" }, "Всеки верен отговор в броя на деня вписва факт с мастило."),
    ),
    ranked ? standing(ranked) : null,
  );
}

/** Where a fact was met, as its entry's dateline says it: „20 ноем. · Брой 9“. */
function whence(f: Learned): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date(f.at));
  const from =
    f.kind === "day" && f.issue ? `Брой ${f.issue}` : f.kind === "duel" ? "Дуел" : f.kind ? "Игра по тема" : "";
  return from ? `${shortDate(day)} ·\u00a0${from}` : shortDate(day);
}

/** How wide an entry's picture is drawn (app.css, .entry-pic): a thumbnail at its right on a phone, beside its
 * question and headword on a big screen. */
const entryPicSizes = "(min-width: 56.25rem) 112px, 88px";

/** A fact as an entry of the book, in the order it was lived: its dateline, the question small (a kicker), the answer
 * as its headword between it and the fact (a statement to judge is its own headword, „Невярно:“ before one that isn't
 * so; an answer of parts a line each), then the fact. Ink (a card with an ink edge and „с мастило“), or grey („в сиво“,
 * outlined thin, lighter). A picture question's picture beside the question and headword (a tap shows it large:
 * showPicture), its credit at the foot. What
 * a search found (`find`) is marked. */
function entry(f: Learned, find: string[]): Child {
  const im = f.image;
  const head = [
    h(
      "p",
      { class: "entry-when" },
      f.ink
        ? h("span", { class: "tag ink" }, h("span", { class: "i i-nib", "aria-hidden": "true" }), "с мастило")
        : h("span", { class: "tag grey" }, "в сиво"),
      whence(f),
    ),
    f.question ? h("p", { class: "entry-q" }, textWords(f.question, find)) : null,
    f.lines?.length
      ? h(
          "ul",
          { class: "entry-lines" },
          f.lines.map((l) => h("li", null, textWords(l, find))),
        )
      : h(
          "p",
          { class: "entry-word" },
          f.untrue ? h("span", { class: "entry-untrue" }, "Невярно: ") : null,
          textWords(f.answer, find),
        ),
  ];
  // The picture first, at the entry's right: its words run beside it and on under it, the fact too, with no hole
  // between the headword and the fact however tall the picture is.
  return h(
    "li",
    { class: `entry ${f.ink ? "ink" : "met"}${im ? " pictured" : ""} ch-${f.chapter}`, "data-fact": f.id },
    im
      ? h(
          "button",
          {
            class: "entry-zoom",
            type: "button",
            "aria-label": "Виж снимката голяма",
            onclick: () => showPicture(f, im),
          },
          h("img", {
            class: "entry-pic",
            src: im.src,
            srcset: im.srcset,
            sizes: entryPicSizes,
            width: im.w,
            height: im.h,
            alt: im.alt,
            loading: "lazy",
            decoding: "async",
          }),
        )
      : null,
    head,
    h("p", { class: "entry-fact" }, textWords(f.fact, find)),
    f.credit ? pictureCredit(f.credit) : null,
  );
}

/** An entry's picture large, on a sheet over the chapter (its thumbnail's tap): its biggest file (the last in its
 * srcset), as large as the screen holds it and never cut, its credit under it, the entry's headword its title. One
 * picture: no zoom, no gallery. Esc, „Затвори“ or a tap beside it puts it away. */
function showPicture(f: Learned, im: Picture): void {
  const biggest = im.srcset.split(",").at(-1)?.trim().split(" ")[0] || im.src;
  const close = () => box.close();
  const box = h(
    "dialog",
    { class: "sheet picture-sheet", "aria-labelledby": "picture-title" },
    h(
      "div",
      { class: "sheet-panel" },
      h(
        "div",
        { class: "sheet-head" },
        h("h2", { id: "picture-title" }, textWords(f.answer)),
        h("button", { class: "link", type: "button", onclick: close }, "Затвори"),
      ),
      h("img", {
        class: "picture-large",
        src: biggest,
        width: im.w,
        height: im.h,
        alt: im.alt,
        decoding: "async",
        style: { "--ratio": String(im.w / im.h) },
      }),
      f.credit ? pictureCredit(f.credit) : null,
    ),
  ) as HTMLDialogElement;
  // A tap beside the sheet puts it away, as Esc does; put away, it goes (the router closes it with the screen).
  box.addEventListener("click", (e) => {
    if (e.target === box) close();
  });
  box.addEventListener("close", () => box.remove());
  document.body.append(box);
  box.showModal();
}

/** Whether the chapter drawn next is come to by a turn of its pages (pager). */
let turned = false;

/** The chapter's pages, as the duels played turn theirs (duelcards.ts, allPlayed): „По-нови“ and „По-стари“ either side
 * of where the page is („Страница 2 от 4“), each off at its end; each a link to its page, so a page is an entry of the
 * history. */
function pager(now: number, pages: number, href: (to: number) => string): Child {
  if (pages < 2) return null;
  const go = (to: number, label: string) =>
    to < 0 || to >= pages
      ? h("button", { class: "btn inline", type: "button", disabled: true }, label)
      : h(
          "a",
          {
            class: "btn inline",
            href: href(to),
            onclick: () => {
              turned = true;
            },
          },
          label,
        );
  return h(
    "nav",
    { class: "pages", "aria-label": "Страници" },
    go(now - 1, "По-нови"),
    h(
      "span",
      { class: "pages-at", "aria-current": "page" },
      `Страница ${formatNumber(now + 1)}\u00a0от\u00a0${formatNumber(pages)}`,
    ),
    go(now + 1, "По-стари"),
  );
}
