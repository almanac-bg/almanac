// Алманах, one of the three places: the player's book (DESIGN.md, Places). Its head — whose book it is, what ink and
// grey mean, and Микс and България as two ways to play — then its chapters, each a card in its colour with its seal as
// the badge and its ink („22 с мастило“), the one nearest its next rank first. A chapter (/almanac/<topic>) is its head
// on its sheet (the seal with its pips, its ink, the next rank), „Игра на главата“, and its facts, ink and grey, the
// latest first, a page at a time, found by their words. How well a player knows a chapter (mastery) is the game's own,
// never shown.

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  api,
  back,
  bulgaria,
  chapterName,
  failure,
  formatNumber,
  glyph,
  h,
  leaf,
  missing,
  onCleanup,
  pips,
  rankName,
  rename,
  seal,
  signal,
  title,
  topics,
  categories,
  user,
} = {} as Kit;

/** A chapter's rank, as kept (play.ChapterRank): level 0 is none yet. */
interface Rank {
  chapter: string;
  level: number;
  name: string;
  /** The quarters of the way to the next rank: 0 to 3. */
  quarter: number;
  ink: number;
  next: string;
  nextAt: number;
}

interface Learned {
  id: string;
  category: string;
  /** The question; none for a statement to judge, whose answer is the statement itself. */
  question?: string;
  answer: string;
  /** A statement that isn't so: its answer is the statement, said untrue. */
  untrue?: boolean;
  fact: string;
  /** Written in ink (right in its issue, met there first), else in grey, as met (play/ink.go). */
  ink?: boolean;
  at: number;
  /** Where it was met: the day's ten (its issue), a chapter's game, a duel. */
  kind?: "day" | "topic" | "duel";
  issue?: number;
}

/** A page of the book (play.Almanac): its facts, how many the chapter (and the search) lists, each chapter's ink (its
 * one number: grey is listed, never counted); with the first page, each chapter's rank, the seal worn, and the day the
 * book began. */
interface Page {
  facts: Learned[];
  found: number;
  ink: Record<string, number>;
  ranks?: Rank[];
  seal?: Rank;
  since?: string;
}

/** How many facts a page shows (play.AlmanacPage). */
const perPage = 30;

function setKit(kit: Kit) {
  ({
    api,
    back,
    bulgaria,
    chapterName,
    failure,
    formatNumber,
    glyph,
    h,
    leaf,
    missing,
    onCleanup,
    pips,
    rankName,
    rename,
    seal,
    signal,
    title,
    topics,
    categories,
    user,
  } = kit);
}

/** The book's chapters, in its order: the bank's topics, then „Микс“ and „България“ (a chapter's page each, played
 * from the book's head). */
const chapters = () => topics.map((t) => t.id);
const nameOf = (id: string) => chapterName(id) || id;

/** Алманах: the book's head, then its chapters. */
export function almanac(kit: Kit): Child {
  setKit(kit);
  title("Алманах");
  // Not a player yet: the book as it starts, its chapters each a way to play one.
  if (!user.peek()) return book({ facts: [], found: 0, ink: {} });
  const page = signal<Page | null>(null);
  const failed = signal<unknown>(null);
  const load = () => {
    failed.set(null);
    api<Page>("GET", "/api/almanac").then(page.set, failed.set);
  };
  load();
  return () => {
    const p = page();
    if (!p) return failed() ? failure(failed(), load) : h("p", { class: "muted" }, "…");
    return book(p);
  };
}

/** The book as a page: its head, and its chapters, the one nearest its next rank first. */
function book(p: Page): Child {
  const name = user.peek()?.name;
  const rankOf = (id: string) => p.ranks?.find((r) => r.chapter === id);
  // The chapter nearest its next rank: the least ink still to come, of those begun.
  const begun = categories.map((c) => rankOf(c.id)).filter((r): r is Rank => !!r && r.level > 0);
  const nearest = begun.sort((a, b) => a.nextAt - a.ink - (b.nextAt - b.ink))[0]?.chapter;
  const order = categories.map((c) => c.id).sort((a, b) => (a === nearest ? -1 : b === nearest ? 1 : 0));
  return h(
    "section",
    { class: "screen book" },
    h(
      "header",
      { class: "book-head" },
      h("h1", null, name ? `Алманахът на ${name}` : "Алманахът ти"),
      h(
        "p",
        { class: "deck" },
        // At zero, said once here, not on each chapter.
        Object.values(p.ink).some(Boolean)
          ? "С мастило са верните отговори от броя на деня. В сиво са останалите срещнати факти."
          : "Всеки верен отговор в броя на деня пише факт с мастило в главата си.",
      ),
      h(
        "div",
        { class: "ways" },
        way("mix", "Микс", "всички глави"),
        bulgaria.open ? way("bulgaria", "България", "въпроси за България") : null,
      ),
    ),
    h(
      "ol",
      { class: "chapters", "aria-label": "Главите" },
      order.map((id) => h("li", null, card(id, p.ink[id] ?? 0, rankOf(id), id === nearest))),
    ),
  );
}

/** One of the ways to play at the book's head: „Микс“ or „България“, its glyph, a word of what it is. */
function way(id: string, name: string, note: string): Child {
  return h(
    "a",
    { class: `way t-${id}`, href: `/play/${id}` },
    glyph(id, 44),
    h("span", { class: "way-words" }, h("b", null, name), h("small", null, note)),
  );
}

/** A chapter's card: its colour, its name, its seal as the badge (or its glyph, before a rank), its ink, and its rank
 * with the ink to the next. The corner turned, as a page of the book. */
function card(id: string, ink: number, r: Rank | undefined, nearest: boolean): Child {
  const ranked = r && r.level > 0 ? r : null;
  const left = ranked ? Math.max(1, ranked.nextAt - ranked.ink) : 0;
  return h(
    "a",
    {
      class: nearest ? "chapter-card nearest" : "chapter-card",
      href: `/almanac/${id}`,
    },
    leaf(
      id,
      [
        h(
          "span",
          { class: "card-top" },
          h("span", { class: "card-name" }, nameOf(id)),
          ranked ? seal(id, ranked.level, 40) : glyph(id, 40),
        ),
        // A counter at zero is hidden: the book's head says once how ink is written.
        ink
          ? h("span", { class: "card-ink" }, h("b", { class: "num" }, formatNumber(ink)), h("span", null, "с мастило"))
          : null,
        ranked ? h("span", { class: "card-rank" }, `${ranked.name} · още ${left} до ${ranked.next}`) : null,
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

/** A chapter of the book (/almanac/<topic>): its head on its sheet, „Игра на главата“, and its facts as entries, the
 * latest first, a page at a time, found by their words. Its page and search are in the address (?page=2&q=…), so back
 * to it, or a reload, opens the same. */
export function chapter(kit: Kit, [id = ""]: string[]): Child {
  setKit(kit);
  // A chapter the book doesn't have: the page that isn't there, not an empty chapter by that name.
  if (!chapters().includes(id)) return missing();
  const name = nameOf(id);
  // Come to by a turn of this chapter's pages: the facts stay in sight once they're in.
  let toFacts = turned;
  turned = false;
  title(name);
  const at = new URLSearchParams(location.search);
  const page = signal(Math.max(0, (Number(at.get("page")) || 1) - 1));
  const query = signal(at.get("q") ?? "");
  const data = signal<Page | null>(null);
  const first = signal<Page | null>(null);
  const failed = signal<unknown>(null);
  let asked = "";
  const load = () => {
    const q = new URLSearchParams({ topic: id, page: String(page.peek()) });
    if (query.peek().trim()) q.set("q", query.peek().trim());
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
        data.set(p);
        if (p.ranks) first.set(p);
        if (toFacts) requestAnimationFrame(() => document.querySelector(".chapter-facts")?.scrollIntoView());
        toFacts = false;
      },
      (err) => {
        if (asked === ask) failed.set(err);
      },
    );
    // The page and the search in the address: back to the chapter opens it as it was.
    const shown = new URLSearchParams();
    if (page.peek()) shown.set("page", String(page.peek() + 1));
    if (query.peek().trim()) shown.set("q", query.peek().trim());
    rename(`/almanac/${id}${shown.size ? `?${shown}` : ""}`);
  };
  if (user.peek()) {
    // The first page has the chapter's rank: asked for once, apart, when the chapter opens on another page.
    if (page.peek() || query.peek())
      api<Page>("GET", `/api/almanac?${new URLSearchParams({ topic: id })}`).then(first.set, () => {});
    load();
  }
  // The chapter's game left half-way today: it goes on from where it stopped (play.Left).
  const left = signal<{ at: number; total: number } | null>(null);
  if (user.peek())
    api<{ runs: { category: string; at: number; total: number }[] }>("GET", "/api/runs/left").then(
      (r) => left.set(r.runs.find((x) => x.category === id) ?? null),
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
    return `/almanac/${id}${shown.size ? `?${shown}` : ""}`;
  };
  const index = chapters().indexOf(id);
  return h(
    "section",
    { class: `screen chapter spread t-${id}` },
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
              index < categories.length ? h("p", { class: "kicker" }, `Глава ${index + 1}`) : null,
              h("h1", null, name),
            ),
          ),
          () =>
            stand(
              id,
              first()?.ranks?.find((r) => r.chapter === id),
              first()?.ink[id] ?? 0,
            ),
        ],
        "chapter-leaf",
      ),
      id !== "bulgaria" || bulgaria.open
        ? h(
            "div",
            { class: "chapter-play" },
            h("a", { class: "btn primary", href: `/play/${id}` }, () =>
              left() ? "Продължи главата" : "Игра на главата",
            ),
            () => {
              const l = left();
              return l ? h("p", { class: "small" }, `Следва въпрос ${l.at + 1} от ${l.total}.`) : null;
            },
          )
        : null,
    ),
    h(
      "section",
      { class: "sect chapter-facts page-2" },
      h("div", { class: "sect-head" }, h("h2", null, "Фактите"), () => {
        const p = data();
        return p
          ? h(
              "span",
              { class: "sect-note" },
              query().trim() ? `намерени ${formatNumber(p.found)}` : `${formatNumber(p.found)}, най-новите първи`,
            )
          : null;
      }),
      user.peek()
        ? h(
            "label",
            { class: "search" },
            h("span", { class: "i i-search", "aria-hidden": "true" }),
            h("input", {
              type: "search",
              "aria-label": "Търси във фактите",
              placeholder: "Търси във фактите",
              maxlength: 60,
              autocomplete: "off",
              enterkeyhint: "search",
              value: query,
              oninput: (e: Event) => search((e.target as HTMLInputElement).value),
            }),
          )
        : null,
      (): Child => {
        if (!user())
          return h("p", { class: "entries-none" }, "Изиграй първите си въпроси и фактите ще се записват тук.");
        const p = data();
        if (!p) return failed() ? failure(failed(), load, null) : h("p", { class: "muted" }, "…");
        if (!p.facts.length)
          return h(
            "p",
            { class: "entries-none" },
            query().trim()
              ? "Нищо не е намерено. Опитай с друга дума."
              : "Тук още няма факти. Всеки въпрос от главата, който срещнеш, записва своя.",
          );
        // Where grey first shows, what it is: once, over the list.
        const grey = p.facts.some((f) => !f.ink);
        return [
          grey
            ? h("p", { class: "grey-note" }, "В сиво са останалите срещнати факти. С мастило пише само броят на деня.")
            : null,
          h(
            "ol",
            { class: "entries" },
            p.facts.map((f) => entry(f)),
          ),
          pager(page(), Math.ceil(p.found / perPage), pageHref),
        ];
      },
    ),
  );
}

/** Where a chapter stands: its seal with the pips towards the next rank, its ink, its rank's name and the ink still to
 * come. Before a rank, what writes its first: a right answer in the day's issue. */
function stand(id: string, r: Rank | undefined, ink: number): Child {
  const ranked = r && r.level > 0 ? r : null;
  return h(
    "div",
    { class: "ch-stand" },
    ranked ? h("span", { class: "ch-seal" }, seal(id, ranked.level, 64, "rimmed"), pips(ranked.quarter)) : null,
    h(
      "div",
      { class: "ch-words" },
      (r?.ink ?? ink)
        ? h("p", { class: "ch-ink" }, h("b", { class: "num" }, formatNumber(r?.ink ?? ink)), " с мастило")
        : null,
      ranked
        ? [
            h("p", { class: "ch-rank" }, rankName(ranked.level)),
            h("p", { class: "ch-next" }, `още ${Math.max(1, ranked.nextAt - ranked.ink)} до ${ranked.next}`),
          ]
        : h("p", { class: "ch-next" }, "Всеки верен отговор в броя на деня пише факт с мастило."),
    ),
  );
}

/** Where a fact was met, as its entry's dateline says it: „20 ноем. · Брой 9“. */
function whence(f: Learned): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date(f.at));
  const from =
    f.kind === "day" && f.issue ? `Брой ${f.issue}` : f.kind === "duel" ? "Дуел" : f.kind ? "Игра на главата" : "";
  return from ? `${shortDate(day)} · ${from}` : shortDate(day);
}

/** A fact as an entry of the book: ink (a card with an ink edge and „мастило“), or grey (outlined thin, lighter); its
 * dateline, the answer as its headword (a statement to judge is its own headword, „Невярно:“ before one that isn't so),
 * the question, and the fact. */
function entry(f: Learned): Child {
  return h(
    "li",
    { class: f.ink ? `entry ink t-${f.category}` : `entry met t-${f.category}` },
    h(
      "p",
      { class: "entry-when" },
      f.ink
        ? h("span", { class: "tag ink" }, h("span", { class: "i i-nib", "aria-hidden": "true" }), "мастило")
        : h("span", { class: "tag grey" }, "срещнат"),
      whence(f),
    ),
    h("p", { class: "entry-word" }, f.untrue ? h("span", { class: "entry-untrue" }, "Невярно: ") : null, f.answer),
    f.question ? h("p", { class: "entry-q" }, f.question) : null,
    h("p", { class: "entry-fact" }, f.fact),
  );
}

/** Whether the chapter drawn next is come to by a turn of its pages (pager). */
let turned = false;

/** The chapter's pages: newer and older, and each by its number (a few around the one open, and the first and the
 * last), each a link to its page. */
function pager(now: number, pages: number, href: (to: number) => string): Child {
  if (pages < 2) return null;
  const shown = [...new Set([0, now - 1, now, now + 1, pages - 1])].filter((n) => n >= 0 && n < pages);
  const go = (to: number, label: Child, cls: string, aria?: string) =>
    h(
      "a",
      {
        class: cls,
        href: href(to),
        "aria-label": aria,
        onclick: () => {
          turned = true;
        },
      },
      label,
    );
  return h(
    "nav",
    { class: "pager", "aria-label": "Страници" },
    now > 0
      ? go(now - 1, ["← ", "По-нови"], "pager-way")
      : h("span", { class: "pager-way off", "aria-hidden": "true" }, "← По-нови"),
    h(
      "span",
      { class: "pager-pages" },
      shown.map((n) =>
        n === now
          ? h("span", { class: "pager-n", "aria-current": "page" }, String(n + 1))
          : go(n, String(n + 1), "pager-n", `Страница ${n + 1}`),
      ),
    ),
    now < pages - 1
      ? go(now + 1, ["По-стари", " →"], "pager-way older")
      : h("span", { class: "pager-way older off", "aria-hidden": "true" }, "По-стари →"),
  );
}
