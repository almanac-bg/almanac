// Алманах, one of the three places: the player's book. Its contents first — a chapter per topic, then „Микс“ and
// „България“, each with how much of it the player knows (its share, its tier, a track in its colour) and its facts —
// and the notes the book keeps (a streak of 7, 30, 100 or 365 days, a first ten of ten, a chapter complete), dated as
// a ledger, with the next one ahead. A chapter (/almanac/<topic>) is how much of it the player knows on its scale,
// „Играй главата“ (a game of its questions: topics are played from here), and its facts as entries, the latest first,
// a page at a time, found by their words.

import type { Note } from "../game/news.ts";
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
  dayInBulgaria,
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

/** A chapter's mastery, as the server sends it (play.Mastery). */
interface Chapter {
  category: string;
  answers: number;
  known: number;
  tier: number;
  name: string;
  next?: string;
  nextAt?: number;
  sure: boolean;
  first?: boolean;
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
 * one number: pencil is listed, never counted); with the first page, the notes, each chapter's mastery, and the day
 * the book began. */
interface Page {
  facts: Learned[];
  found: number;
  ink: Record<string, number>;
  notes?: Note[];
  chapters?: Chapter[];
  since?: string;
}

/** How many facts a page shows (play.AlmanacPage). */
const perPage = 30;

/** The tiers' starts (play.MasteryTiers), above Новак's 0: the ticks on a chapter's scale. */
const tierStarts = [35, 50, 65, 78, 90];

function setKit(kit: Kit) {
  ({
    api,
    back,
    bulgaria,
    dateWords,
    dayInBulgaria,
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
    const mix = p.chapters?.find((c) => c.category === "mix");
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

          figure(told(mix) ? `${mix?.known} %` : "—", "от всичко знаеш"),
        ),
      ),
      contents(p),
      notes(p.notes ?? [], s),
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
      h("span", { class: "sect-note" }, "колко знаеш от всяка глава"),
    ),
    h(
      "ol",
      { class: "toc" },
      chapters().map((id) =>
        tocRow(
          id,
          p,
          p.chapters?.find((c) => c.category === id),
        ),
      ),
    ),
  );
}

/** A number and what it counts, in the row under the book's title. */
const figure = (value: string, label: string) =>
  h("div", { class: "fig" }, h("b", { class: "fig-n" }, value), h("span", { class: "fig-label" }, label));

/** Whether a chapter's share known is told yet: from a first estimate (play.MasteryFirst). */
const told = (c?: Chapter): boolean => !!c && (c.sure || !!c.first);

/** A chapter in the contents: its picture, its name, dotted leaders to the share known, and under them its facts, its
 * tier and a track in its colour. */
function tocRow(id: string, p: Page, chapter?: Chapter): Child {
  const c = chapter && told(chapter) ? chapter : null;
  const known = c ? c.known : 0;
  const meta = [
    id === "mix" ? "всички глави" : inked(p.ink[id] ?? 0),
    c ? (c.sure ? c.name : "първа оценка") : "още без оценка",
  ].join(" · ");
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
      h("span", { class: "toc-known" }, c ? [String(c.known), h("small", null, "%")] : "—"),
      h(
        "span",
        { class: "toc-sub" },
        h("span", null, meta),
        h("span", { class: "toc-track", "aria-hidden": "true" }, h("i", { style: { width: `${known}%` } })),
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

/** The streak's milestones the book notes (play: notes), and how each is written in it. */
const streakWords: Record<number, string> = {
  7: "Седем дни поред. Първата седмица без пропуск.",
  30: "Тридесет дни поред.",
  100: "Сто дни поред.",
  365: "Година поред: 365 дни.",
};

/** The streak's next milestone, ahead. */
const aheadWords: Record<number, string> = {
  7: "Седем дни поред",
  30: "Тридесет дни поред",
  100: "Сто дни поред",
  365: "Година поред",
};

/** A note as the book writes it. */
function noteText(n: Note): string {
  switch (n.kind) {
    case "streak":
      return streakWords[n.n ?? 0] ?? `${n.n} дни поред.`;
    case "perfect":
      return "Първите ти десет от десет.";
    default:
      return `Цялата глава „${nameOf(n.topic ?? "")}“: всеки неин факт.`;
  }
}

/** The streak's next milestone and the day it would come („2026-11-27“), from the streak, whether today's ten are
 * played, and today: a streak that waits on today's ten runs to yesterday (play/runs.go), so today is the first day
 * it grows by; once they're played, tomorrow is. None without a streak, or past the last milestone. */
export function milestoneAhead(
  streak: number,
  playedToday: boolean,
  today: string,
): { n: number; day: string } | undefined {
  const n = streak > 0 ? [7, 30, 100, 365].find((m) => m > streak) : undefined;
  if (!n) return undefined;
  const [y = 1970, m = 1, d = 1] = today.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + n - streak - (playedToday ? 0 : 1)));
  return { n, day: at.toISOString().slice(0, 10) };
}

/** Whether today's ten are played, as this week's strip has it (Monday first). */
function playedOn(s: Stats, today: string): boolean {
  const [y = 1970, m = 1, d = 1] = today.split("-").map(Number);
  return !!s.week[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

/** The notes the book keeps, the latest first, each dated, and the next one ahead, in italic (the streak's next
 * milestone, on the day it would come); nothing while there's neither. */
function notes(list: Note[], s: Stats | null): Child {
  const today = dayInBulgaria();
  const ahead = s ? milestoneAhead(s.streak, playedOn(s, today), today) : undefined;
  if (!list.length && !ahead) return null;
  return h(
    "section",
    { class: "sect book-notes almanac-notes page-1" },
    h("div", { class: "sect-head" }, h("h2", null, "Бележки")),
    h(
      "ol",
      { class: "ledger" },
      ahead
        ? h(
            "li",
            { class: "next" },
            h("span", { class: "ledger-day" }, shortDate(ahead.day)),
            h("span", { class: "ledger-text" }, `${aheadWords[ahead.n]}, ако не спреш.`),
          )
        : null,
      list.map((n) =>
        h(
          "li",
          null,
          h("span", { class: "ledger-day" }, shortDate(n.day)),
          h("span", { class: "ledger-text" }, noteText(n)),
        ),
      ),
    ),
  );
}

/** A chapter of the book (/almanac/<topic>): how much of it the player knows, on its scale; „Играй главата“; its facts
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
        if (p.chapters) first.set(p);
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
    // The first page has the chapter's mastery: asked for once, apart, when the chapter opens on another page.
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
      () => scale(first()?.chapters?.find((c) => c.category === id)),
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

/** How much of the chapter the player knows: the share, set big, a sentence with its tier, and its scale — a track
 * filled in the chapter's colour, a tick at each tier, a mark where the player is, only the ends named. Before a
 * first estimate, how far there is to one. */
function scale(c?: Chapter): Child {
  if (!c) return h("div", { class: "know" });
  if (!told(c)) {
    const left = Math.max(1, 10 - c.answers);
    return h(
      "div",
      { class: "know" },
      h(
        "p",
        { class: "know-words" },
        !c.answers
          ? "Изиграй главата и ще видиш колко от нея знаеш."
          : c.answers < 10
            ? `Още ${left} ${left === 1 ? "отговор" : "отговора"} и ще видиш колко от главата знаеш.`
            : "С първия верен отговор ще видиш колко от главата знаеш.",
      ),
    );
  }
  const words = c.sure
    ? [
        h("b", null, c.name),
        c.next && c.nextAt !== undefined
          ? c.nextAt - c.known <= 5
            ? `, на крачка от „${c.next}“.`
            : `, още ${c.nextAt - c.known} % до „${c.next}“.`
          : ": най-високата степен.",
      ]
    : ["Първа оценка: степента идва с още отговори."];
  return h(
    "div",
    { class: "know" },
    h(
      "div",
      { class: "know-top" },
      h("b", { class: "know-n" }, String(c.known), h("small", null, "%")),
      h("p", { class: "know-words" }, "от главата знаеш. ", words),
    ),
    h(
      "div",
      { class: "scale", role: "img", "aria-label": `Знаеш ${c.known} % от главата` },
      h("i", { class: "scale-fill", style: { width: `${c.known}%` } }),
      tierStarts.map((at) => h("i", { class: "scale-tick", style: { left: `${at}%` } })),
      h("i", { class: "scale-me", style: { left: `${c.known}%` } }),
      h("span", { class: "scale-end" }, "Новак"),
      h("span", { class: "scale-end last" }, "Светило"),
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
