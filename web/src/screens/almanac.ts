// Моят Алманах: what the player has learned — the fact behind every question they've answered right — as cards laid
// as masonry, in the order the facts were learned, the first first. A topic is a quiet filter above. It grows to
// thousands, so it comes a page at a time: the next as the list's end comes near. Above the facts, the notes the book
// keeps of the player's milestones (a streak of 7, 30, 100 or 365 days, a first ten of ten, a chapter complete), the
// latest first: a short list for now, the book's own look comes later.

import type { Note } from "../game/news.ts";
import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  api,
  errorText,
  h,
  lifetime,
  onCleanup,
  signal,
  slot,
  when,
  title,
  categories,
  user,
  formatNumber,
  pageArt,
  toneOf,
  topicMark,
  notedWords,
} = {} as Kit;

interface Learned {
  id: string;
  category: string;
  /** The question; none for a statement to judge, whose answer is the statement itself. */
  question?: string;
  answer: string;
  /** A statement that isn't so: its answer is the statement, said untrue. */
  untrue?: boolean;
  fact: string;
  at: number;
}

/** A page of the almanac, and the counts of the whole: by topic, in all, and of every fact each topic has; with the
 * first page, the notes the book keeps, the latest first. */
interface Page {
  facts: Learned[];
  have: Record<string, number>;
  all: number;
  of: Record<string, number>;
  notes?: Note[];
  next?: string;
}

type Counts = Omit<Page, "facts" | "next">;

export function almanac(kit: Kit) {
  ({
    api,
    errorText,
    h,
    lifetime,
    onCleanup,
    signal,
    slot,
    when,
    title,
    categories,
    user,
    formatNumber,
    pageArt,
    toneOf,
    topicMark,
    notedWords,
  } = kit);
  title("Моят Алманах");
  const counts = signal<Counts | null>(null);
  const topic = signal("");
  const list = slot();
  const show = (t: string) => {
    topic.set(t);
    list.show(() =>
      pages(t, (c) => {
        if (!counts.peek()) counts.set(c);
      }),
    );
  };
  if (user.peek()) show("");
  return h(
    "section",
    { class: "screen almanac" },
    () =>
      user()
        ? h("h1", null, "Моят Алманах")
        : h(
            "div",
            { class: "intro" },
            pageArt("almanac", "tone-gold"),
            h("h1", null, "Моят Алманах"),
            h("p", { class: "lead" }, "Изиграй първите си въпроси и фактите ще се събират тук."),
          ),
    (): Child => {
      const c = counts();
      return c ? [head(c, topic), () => (topic() ? null : notes(c.notes ?? [])), chips(topic, show)] : null;
    },
    list,
  );
}

/** How many facts: all of them learned, or a topic's out of all it has; and what they are. */
function head(c: Counts, topic: () => string): Child {
  return h(
    "div",
    { class: "almanac-head" },
    h(
      "p",
      { class: "almanac-count" },
      h("b", { class: "almanac-n" }, () => formatNumber(topic() ? (c.have[topic()] ?? 0) : c.all)),
      // All of them: how many learned, not of how many there are (a first week's dozen out of thousands looks like
      // nothing). A topic: how many of its facts, the way to „Цяла тема“.
      h("span", null, () => {
        const t = topic();
        if (!t) return c.all === 1 ? " факт досега" : " факта досега";
        const of = c.of[t] ?? 0;
        return ` от ${formatNumber(of)} ${of === 1 ? "факт" : "факта"} в „${categories.find((x) => x.id === t)?.name ?? ""}“`;
      }),
    ),
    h("p", { class: "muted" }, "Фактът към всеки въпрос, на който отговори вярно, по реда, в който ги отключи."),
  );
}

/** The notes the book keeps, the latest first, each with its day: nothing while there are none. */
function notes(list: Note[]): Child {
  if (!list.length) return null;
  return h(
    "section",
    { class: "almanac-notes", "aria-label": "Отбелязано" },
    h("h2", { class: "kicker" }, "Отбелязано"),
    h(
      "ul",
      { class: "almanac-note-list" },
      list.map((n) => h("li", null, notedWords(n))),
    ),
  );
}

/** The topics, a quiet row to read one by: their names only (the counts are in the head, of the one chosen). */
function chips(topic: () => string, show: (t: string) => void): Child {
  return h(
    "ul",
    { class: "chips scroll almanac-topics", "aria-label": "Тема" },
    h(
      "li",
      null,
      h("button", { class: "chip", type: "button", "aria-pressed": () => !topic(), onclick: () => show("") }, "Всички"),
    ),
    categories.map((x) =>
      h(
        "li",
        null,
        h(
          "button",
          {
            class: `chip ${toneOf(x.id)}`,
            type: "button",
            "aria-pressed": () => topic() === x.id,
            onclick: () => show(x.id),
          },
          topicMark(x.id),
          x.name,
        ),
      ),
    ),
  );
}

/** A topic's facts (or all), a page at a time, in the order learned: each page added under the last, the next fetched as the end of the list comes within a screen or so, or with the button
 * that ends it (which tries again after a failed fetch). */
function pages(topic: string, counted: (c: Counts) => void): Child {
  const facts = h("ol", { class: "almanac-list" }) as HTMLElement;
  const next = signal<string | null>(null); // where the next page starts; "" after the last; null before the first
  const busy = signal(false);
  const trouble = signal("");
  const life = lifetime();
  const more = h("button", { class: "btn", type: "button", disabled: busy, onclick: () => load() }, () =>
    trouble() ? "Опитай пак" : "Още факти",
  );
  const near = new IntersectionObserver(
    ([e]) => {
      if (e?.isIntersecting && !trouble.peek()) load();
    },
    { rootMargin: "0px 0px 100% 0px" },
  );
  // Masonry: each card spans the 4px rows its height takes (gap included), so the grid lays it in the column that ends
  // highest. Measured as it's added, before it's drawn; and again whenever its height changes (a narrower screen, the
  // fonts arriving), a frame later: a change made in the observer's own turn would change the page's height there,
  // which another observer watches (prefs.ts), and the browser would call that a loop.
  const span = (el: HTMLElement, height: number) => {
    const rows = `span ${Math.max(1, Math.ceil(height / 4))}`;
    if (el.style.gridRowEnd !== rows) el.style.gridRowEnd = rows;
  };
  const spans = new ResizeObserver((seen) => {
    const sizes = seen.map((e) => [e.target as HTMLElement, e.borderBoxSize[0]?.blockSize ?? 0] as const);
    requestAnimationFrame(() => {
      for (const [el, height] of sizes) span(el, height);
    });
  });
  onCleanup(() => {
    near.disconnect();
    spans.disconnect();
  });
  const load = () => {
    const from = next.peek();
    if (busy.peek() || from === "") return;
    busy.set(true);
    trouble.set("");
    const query = new URLSearchParams({ topic, from: from ?? "" });
    api<Page>("GET", `/api/almanac?${query}`).then(
      (p) => {
        if (life.aborted) return;
        counted(p);
        const added = p.facts.map(entry);
        facts.append(...added);
        next.set(p.next ?? "");
        // Every height read first, then every span set: one layout for the page, not one a card.
        const heights = added.map((el) => el.getBoundingClientRect().height);
        added.forEach((el, i) => {
          span(el, heights[i] ?? 0);
          spans.observe(el);
        });
        busy.set(false);
        // Still near the end (a short page, a tall screen): looked at afresh, it says so again.
        near.unobserve(more);
        if (p.next) near.observe(more);
      },
      (err) => {
        if (life.aborted) return;
        busy.set(false);
        trouble.set(errorText(err));
      },
    );
  };
  load();
  return [
    when(
      () => next() === "" && !facts.childElementCount,
      () =>
        h(
          "p",
          { class: "muted" },
          topic
            ? "Тук още няма факти. Отговори вярно на въпрос от тази тема и фактът му ще се появи тук."
            : "Още няма факти. Всеки верен отговор носи един.",
        ),
      () => facts,
    ),
    () => (trouble() ? h("p", { role: "alert" }, trouble()) : null),
    when(
      () => next() === null && busy() && !trouble(),
      () => h("p", { class: "muted" }, "…"),
    ),
    when(
      () => next() || trouble(),
      () => more,
    ),
  ];
}

/** A fact as a card: its topic, then what was learned as its headline — the answer, under the question
 * asked in a small line; a statement to judge is its own headline („Невярно:“ before one that isn't so) — and the
 * fact. */
function entry(f: Learned): HTMLElement {
  return h(
    "li",
    { class: `almanac-item ${toneOf(f.category)}` },
    h(
      "div",
      { class: "almanac-card" },
      h(
        "p",
        { class: "kicker almanac-topic" },
        topicMark(f.category),
        categories.find((c) => c.id === f.category)?.name ?? "",
      ),
      h(
        "div",
        { class: "almanac-qa" },
        f.question ? h("p", { class: "almanac-q" }, f.question) : null,
        h("p", { class: "almanac-a" }, f.untrue ? h("span", { class: "almanac-untrue" }, "Невярно: ") : null, f.answer),
      ),
      h("p", { class: "almanac-fact" }, f.fact),
    ),
  );
}
