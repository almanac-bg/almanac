// What a game brought, said once, at its end, quietly: the ink it wrote in the Алманах (play/ink.go), a right answer
// in the issue that stayed grey because the book had its fact already, and the chapter nearest its next rank (its
// seal, how much ink is still to come, and the quarters as pips); or the ranks it raised (play/rank.go): several as
// one line, and a rise of the player's best rank as the result's one big moment, the seal set large, with the art
// Страница brings. In a card of its own, once a day, how others' duels against the player's recordings went
// (play/recordings.go). A game that ended without its result on screen has its news told on Днес later (play/told.go):
// under its result, if it's the day's; else under a line that says whose it is. A bad game is never celebrated: what's
// said is what's true of it.

import { api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { rankName, rankNames } from "../seal.ts";
import { chapterName, pips, seal } from "../ui.ts";

interface News {
  /** The facts the game wrote in the Алманах in ink (play.News.Ink). */
  ink?: number;
  /** Right answers in the issue to questions the book had already: their facts stay grey (play: „вече срещан“). */
  metBefore?: number;
  /** The ranks risen since last told, as one (play.Rose): Бележка never; Страница brings the chapter's art; `best`, the
   * player's best rank rose. */
  rose?: { ranks: { chapter: string; name: string; to?: number; art?: boolean }[]; best?: boolean };
  /** After a day's issue, the chapter nearest its next rank (play.Step), when none rose. */
  step?: { chapter: string; left: number; next: string; level?: number; quarter?: number };
  /** Others' duels against the player's recordings, once a day, in a card of its own. */
  recordings?: { text: string };
}

/** The ink each rank starts at (play.Ranks): the quarters to the next are worked out from them where the server
 * doesn't say. */
const rankFrom = [1, 5, 15, 40, 100, 250];

/** A step's rank and quarters: as the server says, or from how much ink the next rank still takes. */
function stepRank(s: NonNullable<News["step"]>): { level: number; quarter: number } {
  if (s.level !== undefined) return { level: s.level, quarter: s.quarter ?? 0 };
  const next = s.next.startsWith("Летопис ·") ? 7 : rankNames.indexOf(s.next) + 1;
  const level = Math.max(0, next - 1);
  const to = next <= 6 ? (rankFrom[next - 1] ?? 1) : 250 + (next - 6) * 100;
  const from = level <= 0 ? 0 : level <= 6 ? (rankFrom[level - 1] ?? 0) : 250 + (level - 6) * 100;
  const ink = to - s.left;
  return { level, quarter: Math.max(0, Math.min(3, Math.floor(((ink - from) / (to - from)) * 4))) };
}

/** What a game brought, asked for once the game (run) is kept (after `delay`: a duel is kept a moment after it ends).
 * Told `late` (on Днес, of a game whose result was never on screen), it comes under a line that says whose it is
 * (`late.title`), if any. */
export function news(run: number, delay = 0, late?: { title?: string }): Child {
  const data = signal<News | null>(null);
  const t = setTimeout(
    () =>
      api<News>("POST", "/api/me/news", { run }).then(
        (n) => data.set(n),
        () => {},
      ),
    delay,
  );
  onCleanup(() => clearTimeout(t));
  return () => {
    const n = data();
    if (!n) return null;
    const best = n.rose?.best ? rankUp(n.rose) : null;
    const lines = [
      n.ink ? inkLine(n.ink) : null,
      n.metBefore ? metLine(n.metBefore) : null,
      n.rose && !best ? roseLine(n.rose) : n.step && !n.rose ? stepLine(n.step) : null,
    ].filter(Boolean);
    const parts = [
      best,
      lines.length ? h("section", { class: "inkline", "aria-label": "Днес в Алманаха" }, lines) : null,
      n.recordings ? recordings(n.recordings) : null,
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
    " с мастило",
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
  const r = stepRank(s);
  return h(
    "p",
    { class: "news-step" },
    r.level > 0 ? h("span", { class: "step-seal" }, seal(s.chapter, r.level, 40), pips(r.quarter)) : null,
    h("span", null, h("b", null, `${chapterName(s.chapter)}:`), ` още ${s.left} до ${s.next}`),
  );
}

/** Ranks risen, the best not among them, as one line, a tap from the book: „Страница в История, Тетрадка в Наука“. */
function roseLine(r: NonNullable<News["rose"]>): Child {
  const said = r.ranks.map((x) => `${x.name} в ${chapterName(x.chapter)}`).join(", ");
  const art = r.ranks.some((x) => x.art) ? " Картината на главата вече може да е твоят аватар." : "";
  return h("p", { class: "news-note news-rose" }, h("a", { href: "/almanac" }, `Нов печат: ${said}.`), art);
}

/** The player's best rank risen: the result's one big moment, the seal set large on its chapter's sheet, its rank's
 * name, and the art it brings. */
function rankUp(r: NonNullable<News["rose"]>): Child {
  const top = r.ranks[0];
  if (!top) return null;
  const level = top.to ?? rankNames.indexOf(top.name) + 1;
  const others = r.ranks.slice(1).map((x) => `${x.name} в ${chapterName(x.chapter)}`);
  return h(
    "section",
    { class: `rankup t-${top.chapter}`, role: "status" },
    seal(top.chapter, level, 96, "rimmed rankup-seal"),
    h("p", { class: "kicker" }, chapterName(top.chapter)),
    h("h2", { class: "rankup-name" }, level > 0 ? rankName(level) : top.name),
    top.art ? h("p", { class: "rankup-art" }, "Картината на главата вече може да е твоят аватар.") : null,
    others.length ? h("p", { class: "rankup-more" }, `И още: ${others.join(", ")}.`) : null,
  );
}

/** Others played against recordings of the player's games: how many, and how it went; never who (they see the
 * player, the player hears numbers: play/recordings.go). */
function recordings(r: NonNullable<News["recordings"]>): Child {
  return h("section", { class: "card stack" }, h("p", { class: "kicker" }, "Твоите записи"), h("p", null, r.text));
}
