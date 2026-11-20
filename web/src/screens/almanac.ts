// Алманах, one of the three places: the player's book. Its contents — a chapter per topic, then „Микс“ and
// „България“, each with its ink and its rank (play/rank.go: named for the book, a track of the quarters to the next).
// A chapter (/almanac/<topic>) is its rank, „Играй главата“ (a game of its questions: topics are played from here),
// and its facts as entries, ink and pencil, the latest first, a page at a time, found by their words. How well a
// player knows a chapter (mastery) is the game's own, never shown.

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { Stats } from "./stats.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  api,
  back,
  bulgaria,
  dateWords,
  failure,
  formatNumber,
  h,
  illustration,
  loadStats,
  missing,
  onCleanup,
  rename,
  signal,
  title,
  topics,
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
  /** Written in ink (right in its issue, met there first), else in pencil (play/ink.go). */
  ink?: boolean;
  at: number;
  /** Where it was learned: the day's ten (its issue), a chapter's game, a duel. */
  kind?: "day" | "topic" | "duel";
  issue?: number;
}

/** A page of the book (play.Almanac): its facts, how many the chapter (and the search) lists, each chapter's ink (its
 * one number: pencil is listed, never counted); with the first page, each chapter's rank, the seal worn, whether the
 * guessing check holds the ranks, and the day the book began. */
interface Page {
  facts: Learned[];
  found: number;
  ink: Record<string, number>;
  ranks?: Rank[];
  seal?: Rank;
  held?: boolean;
  since?: string;
}

/** How many facts a page shows (play.AlmanacPage). */
const perPage = 30;

function setKit(kit: Kit) {
  ({
    api,
    back,
    bulgaria,
    dateWords,
    failure,
    formatNumber,
    h,
    illustration,
    loadStats,
    missing,
    onCleanup,
    rename,
    signal,
    title,
    topics,
    user,
  } = kit);
}

/** The book's chapters, in its order: the bank's topics, then „Микс“ and „България“. */
const chapters = () => topics.map((t) => t.id);
const nameOf = (id: string) => topics.find((t) => t.id === id)?.name ?? id;
const inked = (n: number) => `${formatNumber(n)} с мастило`;

/** A chapter's picture, in its colour. */
const chapterPic = (id: string, cls: string) => illustration(`topic-${id}`, `${cls} t-${id}`);

/** Алманах: the book's contents, its numbers, and its notes. */
export function almanac(kit: Kit): Child {
  setKit(kit);
  title("Алманах");
  // Not a player yet: the book as it starts, its chapters each a way to play one.
  if (!user.peek())
    return h(
      "section",
      { class: "screen book spread" },
      h(
        "div",
        { class: "book-intro page-1" },
        h("p", { class: "kicker" }, "Твоята книга"),
        h("h1", null, "Алманахът ти"),
        h(
          "p",
          { class: "deck" },
          "Всеки верен отговор записва в него по един факт, в главата на темата си. Започва с първия ти брой.",
        ),
      ),
      contents({ facts: [], found: 0, ink: {} }),
    );
  const page = signal<Page | null>(null);
  const stats = signal<Stats | null>(null);
  const failed = signal<unknown>(null);
  const load = () => {
    failed.set(null);
    api<Page>("GET", "/api/almanac").then(page.set, failed.set);
    loadStats().then(stats.set, () => {});
  };
  load();
  return h("section", { class: "screen book spread" }, (): Child => {
    const p = page();
    if (!p) return failed() ? failure(failed(), load) : h("p", { class: "muted" }, "…");
    const s = stats();
    return [
      h(
        "div",
        { class: "book-intro page-1" },
        h("p", { class: "kicker" }, "Твоята книга"),
        h("h1", null, `Алманахът на ${user.peek()?.name ?? ""}`),
        p.since
          ? h("p", { class: "deck" }, `Започнат на ${dateWords(p.since)}. Всеки брой добавя по нещо.`)
          : h("p", { class: "deck" }, "Всеки верен отговор записва по един факт."),
        h(
          "div",
          { class: "figures-row" },
          figure(s ? formatNumber(s.streak) : "…", s?.streak === 1 ? "ден поред" : "дни поред"),
          figure(p.seal ? p.seal.name : "—", p.seal ? `печат: ${nameOf(p.seal.chapter)}` : "звание"),
        ),
        p.held
          ? h(
              "p",
              { class: "small" },
              "Званията от Тетрадка нагоре идват, когато отговорите ти в броевете не са налучкване.",
            )
          : null,
      ),
      contents(p),
    ];
  });
}

/** The book's contents: a chapter a row. */
function contents(p: Page): Child {
  return h(
    "section",
    { class: "sect contents page-2" },
    h(
      "div",
      { class: "sect-head" },
      h("h2", null, "Съдържание"),
      h("span", { class: "sect-note" }, "мастилото и званието на всяка глава"),
    ),
    h(
      "ol",
      { class: "toc" },
      chapters().map((id) =>
        tocRow(
          id,
          p,
          p.ranks?.find((r) => r.chapter === id),
        ),
      ),
    ),
  );
}

/** A number and what it counts, in the row under the book's title. */
const figure = (value: string, label: string) =>
  h("div", { class: "fig" }, h("b", { class: "fig-n" }, value), h("span", { class: "fig-label" }, label));

/** A chapter in the contents: its picture, its name, dotted leaders to its rank, and under them its ink, the next
 * rank and a track of the quarters to it in its colour. „Микс“ and „България“ have their ink only. */
function tocRow(id: string, p: Page, rank?: Rank): Child {
  const r = rank?.level ? rank : null;
  const meta = [id === "mix" ? "всички глави" : inked(p.ink[id] ?? 0), rank ? `следва ${rank.next}` : ""]
    .filter(Boolean)
    .join(" · ");
  return h(
    "li",
    { class: `toc-row t-${id}` },
    h(
      "a",
      { href: `/almanac/${id}` },
      chapterPic(id, "toc-pic"),
      h(
        "span",
        { class: "toc-line" },
        h("span", { class: "toc-name" }, nameOf(id), id === "bulgaria" ? h("i", { class: "flag" }) : null),
        h("span", { class: "toc-dots", "aria-hidden": "true" }),
      ),
      h("span", { class: "toc-known" }, r ? r.name : "—"),
      h(
        "span",
        { class: "toc-sub" },
        h("span", null, meta),
        rank
          ? h(
              "span",
              { class: "toc-track", "aria-hidden": "true" },
              h("i", { style: { width: `${rank.quarter * 25}%` } }),
            )
          : null,
      ),
    ),
  );
}

const shortMonths = ["ян.", "февр.", "март", "апр.", "май", "юни", "юли", "авг.", "септ.", "окт.", "ноем.", "дек."];

/** A day as the ledger dates it: „19 ноем.“ */
function shortDate(day: string): string {
  const [, m = 1, d = 1] = day.split("-").map(Number);
  return `${d} ${shortMonths[m - 1]}`;
}

/** A chapter of the book (/almanac/<topic>): its rank, on its scale; „Играй главата“; its facts
 * as entries, the latest first, a page at a time, found by their words. Its page and search are in the address
 * (?page=2&q=…), so back to it, or a reload, opens the same. */
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
      h(
        "header",
        { class: "chapter-head" },
        h(
          "div",
          { class: "chapter-title" },
          h("p", { class: "kicker chapter-kicker" }, `Глава ${index + 1}`),
          h("h1", null, name),
        ),
        chapterPic(id, "chapter-pic"),
      ),
      () => scale(first()?.ranks?.find((r) => r.chapter === id)),
      id !== "bulgaria" || bulgaria.open
        ? h(
            "div",
            { class: "chapter-play" },
            h("a", { class: "btn primary", href: `/play/${id}` }, () =>
              left() ? "Продължи главата" : "Играй главата",
            ),
            h("p", { class: "small" }, () => {
              const l = left();
              if (l) return `Следва въпрос ${l.at + 1} от ${l.total}.`;
              return id === "mix"
                ? "Десет въпроса от всички глави, по твоята мярка."
                : `Десет въпроса от „${name}“, по твоята мярка.`;
            }),
          )
        : null,
    ),
    h(
      "section",
      { class: "sect chapter-facts page-2" },
      h("div", { class: "sect-head" }, h("h2", null, "Фактите в главата"), () => {
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
              : "Тук още няма факти. Отговори вярно на въпрос от тази глава и фактът му ще се запише тук.",
          );
        return [
          h(
            "ol",
            { class: "entries" },
            p.facts.map((f, i) => entry(f, i === 0)),
          ),
          pager(page(), Math.ceil(p.found / perPage), pageHref),
        ];
      },
    ),
  );
}

/** The chapter's rank: its name, set big, a sentence of the ink to the next, and the quarters toward it on a track in
 * the chapter's colour. Before a rank, what writes one: a right answer in the day's issue. „Микс“ and „България“ have
 * none. */
function scale(r?: Rank): Child {
  if (!r) return h("div", { class: "know" });
  if (!r.level)
    return h(
      "div",
      { class: "know" },
      h("p", { class: "know-words" }, "Всеки верен отговор в броя на деня записва факт с мастило и носи звание."),
    );
  const left = Math.max(1, r.nextAt - r.ink);
  return h(
    "div",
    { class: "know" },
    h(
      "div",
      { class: "know-top" },
      h("b", { class: "know-n" }, r.name),
      h("p", { class: "know-words" }, `${inked(r.ink)}. Още ${left} до „${r.next}“.`),
    ),
    h(
      "div",
      { class: "scale", role: "img", "aria-label": `${r.quarter} от 4 четвърти до „${r.next}“` },
      h("i", { class: "scale-fill", style: { width: `${r.quarter * 25}%` } }),
      [25, 50, 75].map((at) => h("i", { class: "scale-tick", style: { left: `${at}%` } })),
      h("span", { class: "scale-end" }, r.name),
      h("span", { class: "scale-end last" }, r.next),
    ),
  );
}

/** Where a fact was learned, as its entry's dateline says it: „20 ноем. · Брой 9“. */
function whence(f: Learned): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date(f.at));
  const from =
    f.kind === "day" && f.issue ? `Брой ${f.issue}` : f.kind === "duel" ? "Дуел" : f.kind ? "Игра на главата" : "";
  return from ? `${shortDate(day)} · ${from}` : shortDate(day);
}

/** A fact as an entry of the book: its dateline, the answer as its headword (a statement to judge is its own
 * headword, „Невярно:“ before one that isn't so), the question in italic, and the fact (a drop cap in the chapter's
 * colour on the page's first). */
function entry(f: Learned, first: boolean): Child {
  return h(
    "li",
    { class: [`entry t-${f.category}`, first && "first", !f.ink && "pencil"].filter(Boolean).join(" ") },
    h("p", { class: "entry-when" }, whence(f)),
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
