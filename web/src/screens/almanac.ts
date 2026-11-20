// Моят Алманах: what the player has learned — the fact behind every question they've answered right — read as an
// almanac, one list in the order the facts were learned, the first first. A topic is a quiet filter above. It grows to
// thousands, so it comes a page at a time: the next as the list's end comes near.

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
  profileNav,
  questions,
  toneOf,
  topicMark,
  loadMistakes,
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

/** A page of the almanac, and the counts of the whole: by topic, in all, and of every fact each topic has. */
interface Page {
  facts: Learned[];
  have: Record<string, number>;
  all: number;
  of: Record<string, number>;
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
    profileNav,
    questions,
    toneOf,
    topicMark,
    loadMistakes,
  } = kit);
  title("Моят Алманах");
  const counts = signal<Counts | null>(null);
  const topic = signal("");
  const waiting = signal(0);
  const list = slot();
  const show = (t: string) => {
    topic.set(t);
    list.show(() =>
      pages(t, (c) => {
        if (!counts.peek()) counts.set(c);
      }),
    );
  };
  if (user.peek()) {
    loadMistakes().then(
      (m) => waiting.set(m.waiting >= m.from ? m.waiting : 0),
      () => {},
    );
    show("");
  }
  return h(
    "section",
    { class: "screen almanac" },
    // Профил's switch names the place: the heading is for screen readers then, and the page opens on what's in it.
    () => (user() ? profileNav() : null),
    () =>
      user()
        ? h("h1", { class: "sr" }, "Моят Алманах")
        : h(
            "div",
            { class: "intro" },
            pageArt("almanac", "tone-gold"),
            h("h1", null, "Моят Алманах"),
            h("p", { class: "lead" }, "Изиграй първите си въпроси и фактите ще се събират тук."),
          ),
    (): Child => {
      const c = counts();
      return c ? [head(c, topic, waiting), chips(topic, show)] : null;
    },
    list,
  );
}

/** How many facts: all of them learned, or a topic's out of all it has; what they are; and, quietly, the questions
 * missed that wait for a second chance (a line, a tap from them: Начало has its tile too). */
function head(c: Counts, topic: () => string, waiting: () => number): Child {
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
    () =>
      waiting()
        ? h(
            "a",
            { class: "second-chance", href: "/mistakes" },
            `${questions(waiting())} ${waiting() === 1 ? "чака" : "чакат"} Втори шанс`,
          )
        : null,
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
  onCleanup(() => near.disconnect());
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
        for (const f of p.facts) facts.append(entry(f));
        next.set(p.next ?? "");
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

/** A fact as an almanac's entry: its topic, then what was learned as its headline — the answer, under the question
 * asked in a small line; a statement to judge is its own headline („Невярно:“ before one that isn't so) — and the
 * fact. */
function entry(f: Learned): HTMLElement {
  return h(
    "li",
    { class: `almanac-item ${toneOf(f.category)}` },
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
  );
}
