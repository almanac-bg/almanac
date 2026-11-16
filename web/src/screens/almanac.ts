// Моят Алманах: what the player has learned — the fact behind every question they've answered right, by topic. It
// grows to thousands, so it comes a page at a time: the next as the list's end comes near.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal, slot, when } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { categories, user } from "../state.ts";
import { formatNumber, pageArt, profileNav, questions, toneOf, topicMark } from "../ui.ts";
import { loadMistakes } from "./play.ts";

interface Learned {
  id: string;
  category: string;
  question: string;
  answer: string;
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

export function almanac() {
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
    { class: "screen" },
    () => (user() ? profileNav() : null),
    h(
      "div",
      { class: "intro" },
      pageArt("almanac", "tone-gold"),
      h("h1", null, "Моят Алманах"),
      h("p", { class: "lead" }, "Фактът зад всеки въпрос, на който отговори вярно."),
    ),
    () =>
      waiting()
        ? h(
            "div",
            { class: "card second-chance" },
            h("h2", { class: "card-title" }, "Втори шанс"),
            h(
              "p",
              { class: "muted" },
              `${questions(waiting())}, ${waiting() === 1 ? "на който сгреши, чака" : "на които сгреши, чакат"} нов опит. Отговори вярно и фактът е твой.`,
            ),
            h("a", { class: "btn primary", href: "/mistakes" }, "Опитай пак"),
          )
        : null,
    (): Child => {
      if (!user()) return h("p", { class: "muted" }, "Изиграй първите си въпроси и фактите ще се събират тук.");
      const c = counts();
      return c ? [head(c, topic), chips(c, topic, show)] : null;
    },
    list,
  );
}

/** How many facts: all of them learned, or a topic's out of all it has. */
function head(c: Counts, topic: () => string): Child {
  return h(
    "div",
    { class: "card almanac-head" },
    h("b", { class: "almanac-n" }, () => formatNumber(topic() ? (c.have[topic()] ?? 0) : c.all)),
    // All of them: how many learned, not of how many there are (a first week's dozen out of thousands looks like
    // nothing). A topic: how many of its facts, the way to „Цяла тема“.
    h("span", { class: "muted" }, () => {
      const t = topic();
      if (!t) return c.all === 1 ? "научен факт" : "научени факта";
      const of = c.of[t] ?? 0;
      return `от ${formatNumber(of)} ${of === 1 ? "факт" : "факта"} в „${categories.find((x) => x.id === t)?.name ?? ""}“`;
    }),
  );
}

function chips(c: Counts, topic: () => string, show: (t: string) => void): Child {
  return h(
    "ul",
    { class: "chips scroll", "aria-label": "Тема" },
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
          `${x.name} · ${c.have[x.id] ?? 0}/${c.of[x.id] ?? 0}`,
        ),
      ),
    ),
  );
}

/** A topic's facts (or all), a page at a time: each page added under the last, the next fetched as the end of the
 * list comes within a screen or so, or with the button that ends it (which tries again after a failed fetch). */
function pages(topic: string, counted: (c: Counts) => void): Child {
  const ol = h("ol", { class: "almanac-list" });
  const next = signal<string | null>(null); // where the next page starts; "" after the last; null before the first
  const busy = signal(false);
  const trouble = signal("");
  let gone = false;
  onCleanup(() => {
    gone = true;
  });
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
        if (gone) return;
        counted(p);
        ol.append(...p.facts.map(card));
        next.set(p.next ?? "");
        busy.set(false);
        // Still near the end (a short page, a tall screen): looked at afresh, it says so again.
        near.unobserve(more);
        if (p.next) near.observe(more);
      },
      (err) => {
        if (gone) return;
        busy.set(false);
        trouble.set((err as ApiError).message);
      },
    );
  };
  load();
  return [
    when(
      () => next() === "" && !ol.childElementCount,
      () => h("p", { class: "muted" }, "Тук още няма факти. Отговори вярно на въпрос от тази тема и ще дойдат."),
      () => ol,
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

/** A fact as a page of its own: the topic, then the question and its answer as one pair, then what was learned. */
function card(f: Learned): HTMLElement {
  return h(
    "li",
    { class: `card almanac-item ${toneOf(f.category)}` },
    h(
      "p",
      { class: "kicker almanac-topic" },
      topicMark(f.category),
      categories.find((c) => c.id === f.category)?.name ?? "",
    ),
    h(
      "div",
      { class: "almanac-qa" },
      h("p", { class: "almanac-q" }, f.question),
      h("p", { class: "almanac-a" }, f.answer),
    ),
    h("p", { class: "almanac-fact" }, f.fact),
  );
}
