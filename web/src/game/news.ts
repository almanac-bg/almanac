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
import { refreshSeal } from "../state.ts";
import { chapterName, pips, seal } from "../ui.ts";

interface News {
  /** The facts the game wrote in the Алманах in ink (play.News.Ink). */
  ink?: number;
  /** Right answers in the issue to questions the book had already: their facts stay grey (play: „вече срещан“). */
  metBefore?: number;
  /** A chapter's game: the facts it wrote in grey, met first (play.News.Grey). */
  grey?: number;
  /** The ranks risen since last told, as one (play.Rose): Бележка never; Страница brings the chapter's art; `best`, the
   * player's best rank rose. */
  rose?: { ranks: { chapter: string; name: string; to?: number; art?: boolean }[]; best?: boolean };
  /** After a day's issue, the chapter nearest its next rank (play.Step), when none rose: its rank now (0: none yet) and
   * the quarters of the way to the next. */
  step?: { chapter: string; left: number; next: string; level: number; quarter: number };
  /** Others' duels against the player's recordings, once a day, in a card of its own. */
  recordings?: { text: string };
}

/** What a game brought, asked for once the game (run) is kept (after `delay`: a duel is kept a moment after it ends).
 * Told `late` (on Днес, of a game whose result was never on screen), it comes under a line that says whose it is
 * (`late.title`), if any. How others played the player's recordings goes to `recordingsTo`, where given, not with
 * the rest.
 */
export function news(run: number, delay = 0, late?: { title?: string }, recordingsTo?: (view: Child) => void): Child {
  const data = signal<News | null>(null);
  const t = setTimeout(
    () =>
      api<News>("POST", "/api/me/news", { run }).then(
        (n) => {
          data.set(n);
          if (n.recordings && recordingsTo) recordingsTo(recordings(n.recordings));
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
    const best = n.rose?.best ? rankUp(n.rose) : null;
    const lines = [
      n.ink ? inkLine(n.ink) : null,
      n.grey ? greyLine(n.grey) : null,
      n.metBefore ? metLine(n.metBefore) : null,
      n.rose && !best ? roseLine(n.rose) : n.step && !n.rose ? stepLine(n.step) : null,
    ].filter(Boolean);
    const parts = [
      best,
      lines.length ? h("section", { class: "inkline", "aria-label": "Днес в Алманаха" }, lines) : null,
      n.recordings && !recordingsTo ? recordings(n.recordings) : null,
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

/** What a chapter's game wrote in the book, a tap from it: „+4 в сиво“ (only the issue writes ink). */
function greyLine(grey: number): Child {
  return h(
    "a",
    { class: "news-facts ink-row grey-row", href: "/almanac" },
    h("b", { class: "num" }, `+${grey}`),
    " в сиво",
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
    s.level > 0 ? h("span", { class: "step-seal" }, seal(s.chapter, s.level, 40), pips(s.quarter)) : null,
    h("span", null, h("b", null, `${chapterName(s.chapter)}:`), ` още ${s.left} до ${s.next}`),
  );
}

/** Ranks risen, the best not among them (or beside a ten of ten): the seals risen, drawn, and one line for them all,
 * a tap from the book: „Нов печат: Страница в История, Тетрадка в Наука.“ */
function roseLine(r: NonNullable<News["rose"]>): Child {
  const said = r.ranks.map((x) => `${x.name} в ${chapterName(x.chapter)}`).join(", ");
  const art = r.ranks.some((x) => x.art) ? " Картината на главата вече може да е твоят аватар." : "";
  return h(
    "div",
    { class: "news-step news-rose" },
    h(
      "span",
      { class: "rose-seals" },
      r.ranks.map((x) => seal(x.chapter, x.to ?? rankNames.indexOf(x.name) + 1, 40)),
    ),
    h("p", null, h("a", { href: "/almanac" }, `Нов печат: ${said}.`), art),
  );
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
