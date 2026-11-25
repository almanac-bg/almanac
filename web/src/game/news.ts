// What a game brought, said once, at its end, quietly: the ink it wrote in the Алманах (play/ink.go), the whole of it
// at a glance („+6 с мастило“) over the chapters it went to, each its tile and its „+1“, a tap from those facts in
// its chapter, marked there for a moment (/almanac/<chapter>?fact=<id>: screens/almanac.ts); a right answer in the issue
// that stayed grey because the book had its fact already; and the ranks it raised (play/rank.go): several as one line
// (one chapter's with its ladder of ranks), and a rise of the player's best rank as a big moment of the result (ten of
// ten the other; on the rare day both come, both show), the seal set large on its ladder. A game that ended without
// its result on screen has its news told on Днес later (play/told.go): under its result, if it's the day's; else under
// a line that says whose it is. A bad game is never celebrated: what's said is what's true of it.

import { picture } from "../art/picture.ts";
import { api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { formatNumber } from "../lib/words.ts";
import { rankName } from "../seal.ts";
import { chapterName, ladder, seal } from "../ui.ts";

interface News {
  /** The facts the game wrote in the Алманах in ink (play.News.Ink). */
  ink?: number;
  /** The same by chapter, in the order the game asked them (play.News.Chapters), each with the facts written (their
   * questions' ids). */
  chapters?: ChapterInk[];
  /** Right answers in the issue to questions the book had already: their facts stay grey (play: „вече срещан“). */
  metBefore?: number;
  /** The ranks risen since last told, as one (play.Rose): Бележка never; `best`, the player's best rank rose. */
  rose?: { ranks: { chapter: string; name: string; to: number; ink?: number }[]; best?: boolean };
}

interface ChapterInk {
  chapter: string;
  ink: number;
  facts?: string[];
}

/** A chapter of the book at the facts a game wrote in it: they're in the address, and the chapter opens at them, marked
 * (screens/almanac.ts). */
function factsHref(c: ChapterInk): string {
  const q = new URLSearchParams((c.facts ?? []).map((id) => ["fact", id]));
  return `/almanac/${c.chapter}${q.toString() ? `?${q}` : ""}`;
}

/** What a game brought, asked for once the game (run) is kept (after `delay`: a duel is kept a moment after it ends).
 * Told `late` (on Днес, of a game whose result was never on screen), it comes under a line that says whose it is
 * (`late.title`), if any. A best rank risen, the big moment, goes to `bestTo`, where given, not with the rest (the
 * day's result puts it first, under the score). `head`: the section's heading over it, while there's something to
 * tell (the day's result: „Днес в Алманаха“).
 */
export function news(
  run: number,
  delay = 0,
  late?: { title?: string },
  bestTo?: (view: Child) => void,
  head?: string,
): Child {
  const data = signal<News | null>(null);
  const t = setTimeout(
    () =>
      api<News>("POST", "/api/me/news", { run }).then(
        (n) => {
          data.set(n);
          if (n.rose?.best && bestTo) bestTo(rankUp(n.rose));
        },
        () => {},
      ),
    delay,
  );
  onCleanup(() => clearTimeout(t));
  return () => {
    const n = data();
    if (!n) return null;
    const best = !!n.rose?.best && !!n.rose.ranks.length;
    const lines = [
      n.ink ? inkLine(n.ink, n.chapters ?? []) : null,
      n.metBefore ? metLine(n.metBefore) : null,
      n.rose && !best ? roseLine(n.rose) : null,
    ].filter(Boolean);
    const card = lines.length ? h("div", { class: "inkline" }, lines) : null;
    const parts = [
      n.rose && best && !bestTo ? rankUp(n.rose) : null,
      card && head
        ? h("section", { class: "sect day-news" }, h("div", { class: "sect-head" }, h("h2", null, head)), card)
        : card,
    ];
    if (!late?.title) return parts;
    // Late, on Днес: whose news it is, over it; nothing at all when there's nothing to tell.
    return parts.some(Boolean) ? [h("p", { class: "kicker news-late" }, late.title), parts] : null;
  };
}

/** The ink a game wrote, the whole of it at a glance and a tap from the book („+6 с мастило“), and under it the
 * chapters it went to in the order they were asked, each its tile (a right one's, as the score has it) and its „+1“,
 * a tap from those facts in its chapter (read aloud „История: +2“). */
function inkLine(ink: number, chapters: ChapterInk[]): Child {
  return [
    h(
      "a",
      { class: "news-facts ink-row", href: "/almanac" },
      h("span", { class: "i i-nib", "aria-hidden": "true" }),
      h("b", { class: "num" }, `+${ink}`),
      h("span", null, " с\u00a0мастило"),
    ),
    chapters.length
      ? h(
          "ul",
          { class: "ink-chapters", "aria-label": "По теми" },
          chapters.map((c) =>
            h(
              "li",
              null,
              h(
                "a",
                {
                  class: `ink-chapter ch-${c.chapter}`,
                  href: factsHref(c),
                  "aria-label": `${chapterName(c.chapter)}: +${c.ink}`,
                  title: chapterName(c.chapter),
                },
                // As the score's tiles have a right answer: the glyph on its chapter's colour.
                h(
                  "span",
                  { class: `tile right ch-${c.chapter}`, "aria-hidden": "true" },
                  h("span", { class: "tile-pic" }, picture(`chapter-${c.chapter}`)),
                ),
                h("b", { class: "num" }, `+${c.ink}`),
              ),
            ),
          ),
        )
      : null,
  ];
}

/** Right answers whose facts the book had already, met before the issue: they stay grey. */
function metLine(n: number): Child {
  return h(
    "p",
    { class: "news-met" },
    n === 1
      ? "Един от въпросите вече беше в твоя Алманах и остава в сиво."
      : `${n}\u00a0от въпросите вече бяха в твоя Алманах и остават в сиво.`,
  );
}

/** Ranks risen, the best not among them: the seals risen, drawn, and one line for them all,
 * each chapter's name a tap from its page: „Нов печат: „Страница“ в История.“, „Нови печати: „Страница“ в География и
 * в Технологии и игри.“ */
function roseLine(r: NonNullable<News["rose"]>): Child {
  const one = r.ranks.length === 1 ? r.ranks[0] : undefined;
  return h(
    "div",
    { class: "news-rose" },
    h(
      "span",
      { class: "rose-seals" },
      r.ranks.map((x) => seal(x.chapter, x.to, 40)),
    ),
    h("p", null, r.ranks.length === 1 ? "Нов печат: " : "Нови печати: ", risen(r.ranks), "."),
    // One chapter risen: where it stands among the ranks.
    one ? ladder(one.chapter, one.to) : null,
  );
}

type Risen = NonNullable<News["rose"]>["ranks"];

/** The ranks risen in words, each rank once with its chapters, the chapters' names the links (`link`): a list the
 * Bulgarian way, each name with its own „в“, never left at a line's end, and „и“ only before the last, as four chapters'
 * names have an „и“ of their own: „„Страница“ в История, в Кино и телевизия и в Спорт“; ranks apart, „а“ before the
 * last: „„Страница“ в География и в Наука, а „Тетрадка“ в История“. */
export function risen(ranks: Risen, link: (chapter: string) => Child = chapterLink): Child[] {
  const byRank = new Map<string, string[]>();
  for (const x of ranks) byRank.set(x.name, [...(byRank.get(x.name) ?? []), x.chapter]);
  const groups = [...byRank].map(([name, chapters]) => [
    `„${name}“ в\u00a0`,
    ...chapters.flatMap((c, i) => [i === 0 ? null : i === chapters.length - 1 ? " и в\u00a0" : ", в\u00a0", link(c)]),
  ]);
  return groups.flatMap((g, i) => [i === 0 ? null : i === groups.length - 1 ? ", а " : ", ", ...g]);
}

const chapterLink = (chapter: string) => h("a", { href: `/almanac/${chapter}` }, chapterName(chapter));

/** The player's best rank risen: a big moment of the result, on its chapter's sheet: „Нов печат“, the seal set
 * large, its rank's name, what made it („40 факта от История са с мастило в твоя Алманах.“) and its ladder; other
 * ranks risen with it in a line under them. */
function rankUp(r: NonNullable<News["rose"]>): Child {
  const top = r.ranks[0];
  if (!top) return null;
  const level = top.to;
  const others = r.ranks.slice(1);
  return h(
    "section",
    { class: `rankup ch-${top.chapter}`, role: "status" },
    h("p", { class: "kicker" }, "Нов печат"),
    seal(top.chapter, level, 96, "rimmed rankup-seal"),
    h("h2", { class: "rankup-name" }, level > 0 ? rankName(level) : top.name),
    top.ink
      ? h(
          "p",
          { class: "rankup-said" },
          `${formatNumber(top.ink)}\u00a0факта от ${chapterName(top.chapter)} са с\u00a0мастило в твоя Алманах.`,
        )
      : null,
    level > 0 ? ladder(top.chapter, level, 28) : null,
    others.length ? h("p", { class: "rankup-more" }, "И още: ", risen(others), ".") : null,
  );
}
