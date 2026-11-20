// What a game brought, said once, at its end, quietly: the facts it put in the Алманах (what playing gives that only
// goes up), how a topic's game moved its mastery when that's news (a first estimate, a tier reached: never a loss),
// and the notes it wrote in the book — a streak of 7, 30, 100 or 365 days, a first ten of ten, a chapter of the Алманах
// complete. A note is the one big thing: brought forward in a sheet over the result (feel.ts), its sound playing as it
// opens; nothing else is. A bad game is never celebrated: there's nothing to cheer but what's true. On a player's
// first game, a line says what points are. In a card of its own, once a day, how others' duels against the player's
// recordings went (play/recordings.go). A game that ended without its result on screen has its news told on Начало
// later (play/told.go), quietly, with no sheet and no sound: under its result, if it's the day's; else under a line
// that says whose it is.

import { picture } from "../art/picture.ts";
import { api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { feelKit, play, voice } from "../lib/sound.ts";
import { dateWords } from "../lib/words.ts";
import { categories } from "../state.ts";
import { dayPointsWords, explain, meaning } from "../ui.ts";
import { type MasteryMove, masteryLine } from "./mastery.ts";
import { hands, landed } from "./results.ts";

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
  /** The game's kind: what its points are said to be for. */
  kind?: string;
  /** The player's first finished game: what points are is said, once. */
  first?: boolean;
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
 * A note among it is brought forward in a sheet once the result has landed (feel.ts), with its sound then, after the
 * streak's chip has rolled on (`streak.grown`: the day's ten), so that it never covers it. Told `late` (on Начало, of a
 * game whose result was never on screen), it's said without a sheet or a sound, under a line that says whose it is
 * (`late.title`), if any. */
export function news(run: number, delay = 0, streak?: { grown: Promise<unknown> }, late?: { title?: string }): Child {
  const data = signal<News | null>(null);
  let gone = false;
  const t = setTimeout(
    () =>
      api<News>("POST", "/api/me/news", { run }).then(
        async (n) => {
          data.set(n);
          if (late || !n.notes?.length) return;
          const top = biggest(n.notes);
          await landed(run);
          await streak?.grown;
          if (gone) return;
          const kit = feelKit();
          if (!kit) return play("note");
          const s = sheet(top);
          kit.sheet(s, "note", true, { ...hands(), play: voice });
        },
        () => {},
      ),
    delay,
  );
  onCleanup(() => {
    gone = true;
    clearTimeout(t);
  });
  return () => {
    const n = data();
    if (!n) return null;
    const parts = [
      n.first ? pointsLine(n.kind) : null,
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

/** What points are, said once, on a first game: one line, the rest a tap away on the word (with the day's board only
 * after the day's ten: it's theirs). */
function pointsLine(kind?: string): Child {
  return h(
    "p",
    { class: "news-open" },
    explain(h("b", null, "Точките"), kind === "day" ? dayPointsWords : meaning.points),
    " са резултатът ти в една игра.",
  );
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

/** The note a sheet brings forward, of several: the longest streak, else a chapter, else the ten of ten. */
function biggest(notes: Note[]): Note {
  const rank = (n: Note) => (n.kind === "streak" ? 1000 + (n.n ?? 0) : n.kind === "chapter" ? 500 : 0);
  return notes.reduce((a, b) => (rank(b) > rank(a) ? b : a));
}

/** A note's sheet: its picture (the streak's or the ten's number, set large; a chapter's topic), what it is, its name
 * and that it's in the book. The name is the dialog's (id "moment-name"). */
function sheet(n: Note): Element[] {
  const numeral = (text: string) =>
    h("b", { class: "num", style: { font: "900 7.5rem/1 var(--font-numeral)", color: "var(--gold-ink)" } }, text);
  const art =
    n.kind === "streak"
      ? numeral(String(n.n))
      : n.kind === "perfect"
        ? numeral("10")
        : picture(`topic-${n.topic}`, "topic-pic sheet-pic");
  const [kicker, name, line] =
    n.kind === "streak"
      ? ["Серия", `${n.n} дни поред с въпросите на деня.`, "Отбелязано в Алманаха ти."]
      : n.kind === "perfect"
        ? ["Въпросите на деня", "Десет от десет.", "Първият ти ден без грешка. Отбелязано в Алманаха ти."]
        : ["Алманах", `Глава „${topicName(n.topic)}“.`, "Всички факти от темата са в Алманаха ти."];
  return [
    art,
    h("p", { class: "kicker" }, kicker),
    h("strong", { id: "moment-name" }, name),
    h("p", { class: "muted" }, line),
  ] as Element[];
}
