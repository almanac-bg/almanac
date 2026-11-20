// What a game brought, said once, at its end, quietly: what it wrote in the Алманах (the ink counted, pencil only
// said: play/ink.go), and the ranks it raised (as one line, with the art Страница brings) or, after the day's issue,
// the chapter nearest its next rank (play/rank.go). Each is a quiet line under the result: never a sheet over it, as
// the game that brought it may have gone badly, and a bad game is never celebrated. In a card of its own, once a day,
// how others' duels against the player's recordings went (play/recordings.go). A game that ended without its result
// on screen has its news told on Начало later (play/told.go): under its result, if it's the day's; else under a line
// that says whose it is.

import { api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { categories } from "../state.ts";

interface News {
  /** The facts the game wrote in the Алманах in ink (play.News.Ink), and whether it wrote any in pencil (never
   * counted). */
  ink?: number;
  pencil?: boolean;
  /** The ranks risen since last told, as one (play.Rose): Бележка never; Страница brings the chapter's art. */
  rose?: { ranks: { chapter: string; name: string; art?: boolean }[]; best?: boolean };
  /** After a day's issue, the chapter nearest its next rank (play.Step), when none rose. */
  step?: { chapter: string; left: number; next: string };
  /** Others' duels against the player's recordings, once a day, in a card of its own. */
  recordings?: { text: string };
}

const topicName = (id = "") => categories.find((c) => c.id === id)?.name ?? id;

/** What a game brought, asked for once the game (run) is kept (after `delay`: a duel is kept a moment after it ends).
 * Told `late` (on Начало, of a game whose result was never on screen), it comes under a line that says whose it is
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
    const parts = [
      n.ink || n.pencil ? factsLine(n.ink ?? 0) : null,
      n.rose ? roseLine(n.rose) : n.step ? stepLine(n.step) : null,
      n.recordings ? recordings(n.recordings) : null,
    ];
    if (!late?.title) return parts;
    // Late, on Начало: whose news it is, over it; nothing at all when there's nothing to tell.
    return parts.flat().some(Boolean) ? [h("p", { class: "kicker news-late" }, late.title), parts] : null;
  };
}

/** What a game wrote in the Алманах, a tap from it: the ink counted („+6 с мастило“), pencil only said. */
function factsLine(ink: number): Child {
  return h(
    "p",
    { class: "news-facts" },
    h(
      "a",
      { href: "/almanac" },
      ink ? [h("b", { class: "num" }, `+${ink}`), " с мастило в Алманаха"] : "Записано с молив в Алманаха",
    ),
  );
}

/** The ranks risen, as one line, a tap from the book: „Звание: Страница в „История“ · картината ѝ е твоя“. */
function roseLine(r: NonNullable<News["rose"]>): Child {
  const said = r.ranks.map((x) => `${x.name} в „${topicName(x.chapter)}“`).join(", ");
  const art = r.ranks.some((x) => x.art) ? " Картината на главата вече може да е твоят аватар." : "";
  return h("p", { class: "news-note news-rose" }, h("a", { href: "/almanac" }, `Звание: ${said}.`), art);
}

/** The chapter nearest its next rank: „История: още 2 до Тетрадка“. */
function stepLine(s: NonNullable<News["step"]>): Child {
  return h("p", { class: "news-note news-step" }, `${topicName(s.chapter)}: още ${s.left} до ${s.next}`);
}

/** Others played against recordings of the player's games: how many, and how it went; never who (they see the
 * player, the player hears numbers: play/recordings.go). */
function recordings(r: NonNullable<News["recordings"]>): Child {
  return h("section", { class: "card stack" }, h("p", { class: "kicker" }, "Твоите записи"), h("p", null, r.text));
}
