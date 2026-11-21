// What a game brought, said once, at its end, quietly: the ink it wrote in the Алманах (play/ink.go), a right answer
// in the issue that stayed grey because the book had its fact already, and the chapter nearest its next rank (its
// seal, how much ink is still to come, and the quarters as pips); or the ranks it raised (play/rank.go): several as
// one line (one chapter's with its ladder of ranks), and a rise of the player's best rank as the result's one big
// moment, the seal set large on its ladder, with the art Страница brings. A game that ended without its result on screen has
// its news told on Днес later (play/told.go): under its result, if it's the day's; else under a line that says whose it
// is. A bad game is never celebrated: what's said is what's true of it.

import { api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { formatNumber } from "../lib/words.ts";
import { rankName, rankNames } from "../seal.ts";
import { refreshSeal } from "../state.ts";
import { chapterName, ladder, pips, seal } from "../ui.ts";

interface News {
  /** The facts the game wrote in the Алманах in ink (play.News.Ink). */
  ink?: number;
  /** Right answers in the issue to questions the book had already: their facts stay grey (play: „вече срещан“). */
  metBefore?: number;
  /** The ranks risen since last told, as one (play.Rose): Бележка never; Страница brings the chapter's art; `best`, the
   * player's best rank rose. */
  rose?: { ranks: { chapter: string; name: string; to?: number; ink?: number; art?: boolean }[]; best?: boolean };
  /** After a day's issue, the chapter nearest its next rank (play.Step), when none rose: its rank now (0: none yet) and
   * the quarters of the way to the next. */
  step?: { chapter: string; left: number; next: string; level: number; quarter: number };
}

/** What a game brought, asked for once the game (run) is kept (after `delay`: a duel is kept a moment after it ends).
 * Told `late` (on Днес, of a game whose result was never on screen), it comes under a line that says whose it is
 * (`late.title`), if any. A best rank risen, the big moment, goes to `bestTo`, where given, not with the rest (the
 * day's result puts it first, under the score).
 */
export function news(run: number, delay = 0, late?: { title?: string }, bestTo?: (view: Child) => void): Child {
  const data = signal<News | null>(null);
  const t = setTimeout(
    () =>
      api<News>("POST", "/api/me/news", { run }).then(
        (n) => {
          data.set(n);
          if (n.rose?.best && bestTo) bestTo(rankUp(n.rose));
          // Ink written, or a rank risen: the seal worn may be another now (a first one, or the best risen).
          if (n.ink || n.rose) refreshSeal();
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
      n.ink ? inkLine(n.ink) : null,
      n.metBefore ? metLine(n.metBefore) : null,
      n.rose && !best ? roseLine(n.rose) : n.step && !n.rose ? stepLine(n.step) : null,
    ].filter(Boolean);
    const parts = [
      n.rose && best && !bestTo ? rankUp(n.rose) : null,
      lines.length ? h("section", { class: "inkline", "aria-label": "Днес в Алманаха" }, lines) : null,
    ];
    if (!late?.title) return parts;
    // Late, on Днес: whose news it is, over it; nothing at all when there's nothing to tell.
    return parts.some(Boolean) ? [h("p", { class: "kicker news-late" }, late.title), parts] : null;
  };
}

/** The ink a game wrote, a tap from the book: „+6 с мастило“. */
function inkLine(ink: number): Child {
  return h(
    "a",
    { class: "news-facts ink-row", href: "/almanac" },
    h("span", { class: "i i-nib", "aria-hidden": "true" }),
    h("b", { class: "num" }, `+${ink}`),
    "\u00a0с\u00a0мастило",
  );
}

/** Right answers whose facts the book had already, met before the issue: they stay grey. */
function metLine(n: number): Child {
  return h(
    "p",
    { class: "news-met" },
    n === 1
      ? "Един от въпросите вече беше в твоя Алманах и остава в сиво."
      : `${n} от въпросите вече бяха в твоя Алманах и остават в сиво.`,
  );
}

/** The chapter nearest its next rank: its seal and pips, „История: още 2 до Тетрадка“. */
function stepLine(s: NonNullable<News["step"]>): Child {
  return h(
    "p",
    { class: "news-step" },
    s.level > 0 ? h("span", { class: "step-seal" }, seal(s.chapter, s.level, 40)) : null,
    h(
      "span",
      { class: "step-words" },
      h("span", null, h("b", null, `${chapterName(s.chapter)}:`), ` още ${s.left}\u00a0с мастило до „${s.next}“`),
      s.level > 0 ? pips(s.quarter) : null,
    ),
  );
}

/** Ranks risen, the best not among them (or beside a ten of ten): the seals risen, drawn, and one line for them all,
 * each chapter's name a tap from its page: „Нов печат: „Страница“ в История.“, „Нови печати: „Страница“ в География и
 * в Технологии и игри.“; and the art they bring, once: „Картината на тази глава вече може да е твой аватар.“ */
function roseLine(r: NonNullable<News["rose"]>): Child {
  const one = r.ranks.length === 1 ? r.ranks[0] : undefined;
  return h(
    "div",
    { class: "news-step news-rose" },
    h(
      "span",
      { class: "rose-seals" },
      r.ranks.map((x) => seal(x.chapter, x.to ?? rankNames.indexOf(x.name) + 1, 40)),
    ),
    h("p", null, r.ranks.length === 1 ? "Нов печат: " : "Нови печати: ", risen(r.ranks), ".", artLine(r.ranks)),
    // One chapter risen: where it stands among the ranks.
    one ? ladder(one.chapter, one.to ?? rankNames.indexOf(one.name) + 1) : null,
  );
}

type Risen = NonNullable<News["rose"]>["ranks"];

/** The ranks risen in words, each rank once with its chapters, the chapters' names the links:
 * „„Страница“ в География и в Наука, „Тетрадка“ в История“. */
function risen(ranks: Risen): Child[] {
  const byRank = new Map<string, string[]>();
  for (const x of ranks) byRank.set(x.name, [...(byRank.get(x.name) ?? []), x.chapter]);
  const groups = [...byRank].map(([name, chapters]) => [
    `„${name}“ в `,
    ...chapters.flatMap((c, i) => [i ? " и в " : null, chapterLink(c)]),
  ]);
  return groups.flatMap((g, i) => [i === 0 ? null : i === groups.length - 1 ? " и " : ", ", ...g]);
}

const chapterLink = (chapter: string) => h("a", { href: `/almanac/${chapter}` }, chapterName(chapter));

/** The art the ranks risen bring (Страница reached), said once: „Картините на тези глави вече могат да са твой
 * аватар.“; named, where not every chapter risen brings it. */
function artLine(ranks: Risen): string {
  const art = ranks.filter((x) => x.art);
  if (!art.length) return "";
  if (art.length === ranks.length)
    return art.length === 1
      ? " Картината на тази глава вече може да е твой аватар."
      : " Картините на тези глави вече могат да са твой аватар.";
  const names = art.map((x) => chapterName(x.chapter));
  return art.length === 1
    ? ` Картината на ${names[0]} вече може да е твой аватар.`
    : ` Картините на ${names.slice(0, -1).join(", ")} и ${names.at(-1)} вече могат да са твой аватар.`;
}

/** The player's best rank risen: the result's one big moment, on its chapter's sheet: „Нов печат“, the seal set
 * large, its rank's name, what made it („40 факта от История са с мастило в твоя Алманах.“), its ladder, and the art
 * it brings; other ranks risen with it in a line under them. */
function rankUp(r: NonNullable<News["rose"]>): Child {
  const top = r.ranks[0];
  if (!top) return null;
  const level = top.to ?? rankNames.indexOf(top.name) + 1;
  const others = r.ranks.slice(1);
  return h(
    "section",
    { class: `rankup t-${top.chapter}`, role: "status" },
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
    top.art ? h("p", { class: "rankup-art" }, "Картината на тази глава вече може да е твой аватар.") : null,
    others.length ? h("p", { class: "rankup-more" }, "И още: ", risen(others), ".", artLine(others)) : null,
  );
}
