// Теми: questions by topic, as many as you like, shaped by how well you know the topic. Everyone plays the same
// game. The tiles live on Начало (all the topics at once first, and Втори шанс beside it while questions wait for one,
// then each topic, and one for „България“, the questions about Bulgaria from every topic, while the bank has them); a
// run of one is /play/<topic>, whose result offers ten more at once, and another topic a tap away.

import { picture } from "../art/picture.ts";
import { type Mastery, masteryBadge } from "../game/mastery.ts";
import { news } from "../game/news.ts";
import { challengeButton, challengeText, summary } from "../game/results.ts";
import { getReady, playRun, shownHere, startScreen } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal, slot } from "../lib/dom.ts";
import { byTap, entry, go, goBack, hold, mark, title } from "../lib/router.ts";
import { bulgaria, type Category, categories, player, user } from "../state.ts";
import { meter, questions, stakeLine, toneOf, topicMark } from "../ui.ts";
import { loadStats, type Stats } from "./stats.ts";

/** The topics as tiles, each with how well the player knows it: a run across all of them first, and the second chance
 * right after it while questions wait for one (at the end of the list it went unseen); „България“ across them after
 * the topics (no mastery of its own: its answers count in their own topics). A game left half-way today says so on
 * its tile, where it goes on from. */
export function topics(): Child {
  const stats = signal<Stats | null>(null);
  const waiting = signal(0);
  const left = signal<LeftRun[]>([]);
  if (user.peek()) {
    loadStats().then(stats.set, () => {});
    loadMistakes().then(
      (m) => waiting.set(m.waiting >= m.from ? m.waiting : 0),
      () => {},
    );
    loadLeft().then(left.set, () => {});
  }
  // „Продължи · въпрос 4 от 10“, on the tile of a game left half-way (in place of what it says otherwise).
  const goesOn = (kind: LeftRun["kind"], category = ""): Child => {
    const l = left().find((r) => r.kind === kind && r.category === category);
    return l ? h("span", { class: "topic-meta topic-left" }, `Продължи · въпрос ${l.at + 1} от ${l.total}`) : null;
  };
  return h(
    "section",
    { class: "stack" },
    h("h2", { class: "section-title" }, "Теми"),
    h("ul", { class: "topics" }, () => {
      const mine = stats()?.mastery ?? [];
      return [
        // First, where a thumb lands first: a tile in the corner reads as „all of them“, so it's this one.
        h(
          "li",
          { class: "topic-all" },
          h(
            "a",
            { href: "/play/all", class: "topic tone-gold" },
            h(
              "span",
              { class: "topic-text" },
              h("span", { class: "topic-name" }, "Всички теми"),
              goesOn("topic") ?? h("span", { class: "topic-meta" }, "Въпроси от всички теми"),
            ),
          ),
        ),
        waiting() || goesOn("mistakes")
          ? h("li", { class: "topic-all" }, secondChance(waiting(), goesOn("mistakes")))
          : null,
        ...categories.map((c) =>
          h(
            "li",
            null,
            tile(
              c,
              mine.find((m) => m.category === c.id),
              goesOn("topic", c.id),
            ),
          ),
        ),
        bulgaria.open
          ? h(
              "li",
              { class: "topic-all" },
              h(
                "a",
                { href: `/play/${bulgaria.id}`, class: "topic tone-mint" },
                picture(`topic-${bulgaria.id}`, "topic-pic"),
                h(
                  "span",
                  { class: "topic-text" },
                  h("span", { class: "topic-name" }, bulgaria.name),
                  goesOn("topic", bulgaria.id) ??
                    h("span", { class: "topic-meta" }, "Въпроси за България от всяка тема"),
                ),
              ),
            )
          : null,
      ];
    }),
  );
}

/** How many questions wait for the player's second chance, and from how many it opens. */
export const loadMistakes = () => api<{ waiting: number; from: number }>("GET", "/api/mistakes");

/** The way into a second chance: the questions the player got wrong, asked again (/mistakes). */
export function secondChance(waiting: number, left: Child = null): Child {
  return h(
    "a",
    { href: "/mistakes", class: "topic tone-rose" },
    h(
      "span",
      { class: "topic-text" },
      h("span", { class: "topic-name" }, "Втори шанс"),
      left ??
        h("span", { class: "topic-meta" }, `${questions(waiting)}, ${waiting === 1 ? "на който" : "на които"} сгреши`),
    ),
  );
}

/** A topic: its picture and colour, its name, and how well the player knows it (once they've played enough of it to
 * tell: a first estimate as a share alone, its tier once the mark is sure; Профил has the rest). */
function tile(c: Category, m: Mastery | undefined, left: Child): Child {
  const sure = m?.sure ? m : null;
  const first = m?.first ? m : null;
  return h(
    "a",
    { href: `/play/${c.id}`, class: `topic ${toneOf(c.id)}` },
    picture(`topic-${c.id}`, "topic-pic"),
    h(
      "span",
      { class: "topic-text" },
      h("span", { class: "topic-name" }, c.name),
      left ??
        (sure
          ? h("span", { class: "topic-meta" }, masteryBadge(sure), h("b", { class: "num" }, `${sure.known}%`))
          : first
            ? h("span", { class: "topic-meta" }, `първа оценка · ${first.known}%`)
            : null),
    ),
    sure ? meter(sure.known, `знаеш ${sure.known}% от темата`) : null,
  );
}

export function topic([id = ""]: string[]) {
  const category = id === "all" ? "" : id;
  const name = !category
    ? "Всички теми"
    : category === bulgaria.id
      ? bulgaria.open
        ? bulgaria.name
        : undefined
      : categories.find((c) => c.id === category)?.name;
  if (name === undefined) {
    go("/", true);
    return null;
  }
  title(name);
  // While the day's ten wait, a topic's result points to them (the habit comes first), with the streak at stake.
  // Asked as the screen opens and as each game starts (a new player is a player only then), so it's in long before
  // the game ends.
  const day = signal<DayWaits | null>(null);
  const ask = () =>
    dayWaits().then(
      (d) => day.set(d),
      () => {},
    );
  if (user.peek()) ask();
  return run({
    name,
    lead: "Десет въпроса по темата, от лесен към труден.",
    begin: async () => {
      const s = await api<State>("POST", "/api/topic", { category });
      ask();
      return s;
    },
    left: (l) => l.kind === "topic" && l.category === category,
    finished: (s, again, just) =>
      h(
        "div",
        { class: "screen" },
        // What was played, where the day's result has its date: every result laid out the same. (The day's state is
        // in long before a game ends: as it was then, never drawing the result again.)
        summary(
          s,
          h("div", { class: "day-line" }, h("span", { class: "kicker" }, name)),
          {
            main: () => nextOf(day(), again).main,
            also: [() => nextOf(day(), again).also, challenged(s, category ? name : undefined)],
          },
          just ? [otherTopics(category), news(s.id)] : [otherTopics(category)],
          undefined,
          just,
        ),
      ),
  });
}

/** A topic's result's buttons: „Още десет“, gold; or, while the day's ten wait, the way to them, gold, with the streak
 * at stake under it, and „Още десет“ plain. */
function nextOf(d: DayWaits | null, again: () => void): { main: Child; also: Child[] } {
  if (!d)
    return {
      main: h("button", { class: "btn primary big", onclick: again }, "Още десет"),
      also: [h("a", { class: "btn", href: "/" }, "Към Начало")], // where the day and the other topics are
    };
  return {
    main: [h("a", { class: "btn primary big", href: "/" }, "Към въпросите на деня"), stakeLine(d.streak, d.reserve)],
    also: [h("button", { class: "btn", onclick: again }, "Още десет")],
  };
}

/** How many other topics a topic's result offers. */
const othersShown = 3;

/** Under a topic's result, a way to another, a tap away (Начало's tiles are a scroll from there): the ones the player
 * has played least first, so that the game goes round what they know; under a game of all of them, the topics. */
function otherTopics(current: string): Child {
  const stats = signal<Stats | null>(null);
  loadStats().then(stats.set, () => {});
  return () => {
    const answers = (id: string) => stats()?.mastery.find((m) => m.category === id)?.answers ?? 0;
    const others = categories
      .filter((c) => c.id !== current)
      .map((c, i) => ({ c, i }))
      .sort((a, b) => answers(a.c.id) - answers(b.c.id) || a.i - b.i)
      .slice(0, othersShown)
      .map(({ c }) => c);
    if (!stats()) return null;
    return h(
      "nav",
      { class: "other-topics", "aria-label": "Друга тема" },
      h("p", { class: "kicker" }, "Друга тема"),
      h(
        "ul",
        { class: "chips" },
        others.map((c) => h("li", null, h("a", { class: "chip", href: `/play/${c.id}` }, topicMark(c.id), c.name))),
      ),
    );
  };
}

/** A topic's game of ten, as a challenge to anyone (play/challenges.go): „Предизвикай“, plain, after the rest. */
function challenged(s: State, topic?: string): Child {
  if (s.total !== 10) return null;
  return challengeButton("Предизвикай", s.id, () => challengeText(s.rights, topic));
}

/** The day's ten, while they wait for the player: the streak (to yesterday) and the reserve days in hand. */
interface DayWaits {
  streak: number;
  reserve: number;
}

/** Whether the day's ten still wait for the player (null once played), from Начало's state. */
async function dayWaits(): Promise<DayWaits | null> {
  const t = await api<{ streak: number; reserve?: number; run: State | null }>("GET", "/api/day");
  return t.run?.done ? null : { streak: t.streak, reserve: t.reserve ?? 0 };
}

/** A game of the player's own left unfinished today (play.Left): a topic's or a second chance's, how far it got, and
 * whether its question is showing, its time running. */
export interface LeftRun {
  id: number;
  kind: "topic" | "mistakes";
  category: string;
  at: number;
  total: number;
  open?: boolean;
}

/** The games the player left unfinished today (none for one who hasn't played). */
export async function loadLeft(): Promise<LeftRun[]> {
  if (!user.peek()) return [];
  return (await api<{ runs: LeftRun[] }>("GET", "/api/runs/left")).runs;
}

/** A run of the player's own, as its screen plays it: what it's called and is (`name`, `lead`), how it starts
 * (`begin`: a new one, or the one left today), which of the games left today it is (`left`), what its end draws
 * (`finished`: `again` plays another, `just` says it was played this moment, so its news is told), and, if it can't
 * be played now, why (`closed`: asked before anything starts). */
interface Run {
  name: string;
  lead: string;
  begin: () => Promise<State>;
  left: (l: LeftRun) => boolean;
  finished: (s: State, again: () => void, just: boolean) => Child;
  closed?: () => Promise<Child>;
}

/** Plays a run (a topic's, a second chance). Opened by a tap, it starts after a short count, which the player can cut
 * short or back out of (back where they came from); come to otherwise (a reload, back or forward, a link from outside),
 * nothing starts by itself: the screen says what it is, or where it was left, with „Започни“ or „Продължи“. A game
 * finished here shows its result again; one whose question this tab was showing goes straight back to it, its time
 * running (as one opened by a tap does). */
export function run(r: Run): Child {
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  const ready = () => {
    hold();
    screen.show(() => getReady(r.name, start, () => goBack("/")));
  };
  // Another from a result starts at once: the player is ready.
  const again = () => {
    hold();
    start();
  };
  const play = (s: State) => screen.show(() => playRun(s, (end) => r.finished(end, again, true)));
  // What comes back once the screen is gone (another page opened meanwhile) does nothing: a game's entry held over
  // that page, or its entry marked, would be another page's.
  let gone = false;
  onCleanup(() => {
    gone = true;
  });
  const start = async () => {
    screen.show(() => h("p", { class: "muted" }, "…"));
    try {
      await player();
      const s = await r.begin();
      if (!gone) play(s);
    } catch (err) {
      if (gone) return;
      screen.show(() =>
        h(
          "div",
          { class: "stack" },
          h("p", { role: "alert" }, (err as ApiError).message),
          h("button", { class: "btn primary", onclick: start }, "Опитай пак"),
        ),
      );
    }
  };
  const tap = byTap();
  const kept = entry().result;
  (async () => {
    if (kept) {
      const s = await api<State>("GET", `/api/runs/${kept}`).catch(() => null);
      if (gone) return;
      if (s?.done) return screen.show(() => r.finished(s, again, false));
      mark({ result: undefined });
    }
    const left = (await loadLeft().catch(() => [])).find(r.left);
    if (gone) return;
    // Its question showing, its time running: straight back in, where that tab was showing it or a tap asked.
    if (left?.open && (tap || shownHere(left.id))) {
      const s = await api<State>("GET", `/api/runs/${left.id}`).catch(() => null);
      if (gone) return;
      if (s && !s.done) return play(s);
    }
    if (!left) {
      const closed = await r.closed?.();
      if (gone) return;
      if (closed) return screen.show(() => closed);
    }
    if (tap) return ready();
    const marks = left ? (await api<State>("GET", `/api/runs/${left.id}`).catch(() => null))?.trail : undefined;
    if (gone) return;
    screen.show(() =>
      startScreen(r.name, r.lead, left ? { at: left.at, total: left.total, marks } : null, () =>
        left?.open ? start() : ready(),
      ),
    );
  })();
  return h("div", null, screen);
}
