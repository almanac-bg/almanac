// What a game brought, said once, at its end, quietly: the facts it put in the Алманах (what playing gives that only
// goes up), how a topic's game moved its mastery when that's news (a first estimate, a tier reached: never a loss),
// and the notes it wrote in the book — a streak of 7, 30, 100 or 365 days, a first ten of ten, a chapter of the Алманах
// complete. Each is a quiet line under the result, a note too: never a sheet over it and never a medal, as the game
// that brought it may have gone badly (a streak's milestone may come with two right of ten), and a bad game is never
// celebrated. In a card of its own, once a day, how others'
// duels against the player's recordings went (play/recordings.go). A game that ended without its result on screen has
// its news told on Начало later (play/told.go): under its result, if it's the day's; else under a line that says whose
// it is.

import { api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { dateWords } from "../lib/words.ts";
import { categories } from "../state.ts";
import { type MasteryMove, masteryLine } from "./mastery.ts";

/** A milestone noted in the player's book (play.Note): the day it happened, and what it was. */
export interface Note {
  day: string;
  kind: "streak" | "perfect" | "chapter";
  /** A streak's days in a row: 7, 30, 100 or 365. */
  n?: number;
  /** A chapter's topic, every fact of which is in the Алманах. */
  topic?: string;
}

interface News {
  /** The facts the game put in Моят Алманах. */
  facts?: number;
  /** How a topic's game moved its mastery, when that's news (play.masteryTold). */
  mastery?: MasteryMove;
  /** The milestones noted in the book with this news, oldest first, each told once. */
  notes?: Note[];
  /** Others' duels against the player's recordings, once a day, in a card of its own. */
  recordings?: { text: string };
}

const topicName = (id = "") => categories.find((c) => c.id === id)?.name ?? id;

/** A note in words, as the book lists it: „30 дни поред с въпросите на деня“. */
export function noteWords(n: Note): string {
  switch (n.kind) {
    case "streak":
      return `${n.n} дни поред с въпросите на деня`;
    case "perfect":
      return "Десет от десет на въпросите на деня";
    default:
      return `Цялата глава „${topicName(n.topic)}“: всички факти от темата`;
  }
}

/** A note with its day, as Моят Алманах lists them: „20 ноември · 30 дни поред с въпросите на деня“. */
export const notedWords = (n: Note) => `${dateWords(n.day)} · ${noteWords(n)}`;

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
      n.facts ? factsLine(n.facts) : null,
      masteryLine(n.mastery),
      n.notes?.length ? notesLine(n.notes) : null,
      n.recordings ? recordings(n.recordings) : null,
    ];
    if (!late?.title) return parts;
    // Late, on Начало: whose news it is, over it; nothing at all when there's nothing to tell.
    return parts.flat().some(Boolean) ? [h("p", { class: "kicker news-late" }, late.title), parts] : null;
  };
}

/** The facts a game put in Моят Алманах, a tap from them. */
function factsLine(n: number): Child {
  return h(
    "p",
    { class: "news-facts" },
    h("a", { href: "/almanac" }, h("b", { class: "num" }, `+${n}`), ` ${n === 1 ? "факт" : "факта"} в Алманаха`),
  );
}

/** The notes just written in the book, in a quiet line (one after another, if a game brought several), a tap from
 * the book. */
function notesLine(notes: Note[]): Child {
  return h(
    "p",
    { class: "news-note" },
    h("a", { href: "/almanac" }, "Отбелязано в Алманаха"),
    `: ${notes.map(noteWords).join("; ")}.`,
  );
}

/** Others played against recordings of the player's games: how many, and how it went; never who (they see the
 * player, the player hears numbers: play/recordings.go). */
function recordings(r: NonNullable<News["recordings"]>): Child {
  return h("section", { class: "card stack" }, h("p", { class: "kicker" }, "Твоите записи"), h("p", null, r.text));
}
