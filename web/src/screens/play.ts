// A chapter's game: questions by topic, as many as you like, shaped by how well you know the topic. Everyone plays
// the same game. It's started from its chapter in the Алманах („Играй главата“: a topic, „Микс“ — every topic at once —
// or „България“ — the questions about Bulgaria from every topic, while the bank has them); a run of one is
// /play/<topic>, whose result offers ten more at once, the way back to its chapter, and another chapter a tap away.

import { news } from "../game/news.ts";
import { summary } from "../game/results.ts";
import { getReady, playRun, shownHere, starting, startScreen } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { api, errorText } from "../lib/api.ts";
import { type Child, h, lifetime, signal, slot } from "../lib/dom.ts";
import { backOut, byTap, entry, hold, mark, title } from "../lib/router.ts";
import { bulgaria, categories, mix, player, user } from "../state.ts";
import { stakeLine, toneOf, topicMark } from "../ui.ts";
import { missing } from "./missing.ts";

export function topic([category = ""]: string[]) {
  const name =
    category === mix.id
      ? mix.name
      : category === bulgaria.id
        ? bulgaria.open
          ? bulgaria.name
          : undefined
        : categories.find((c) => c.id === category)?.name;
  // A topic the game doesn't have (an old link, a topic renamed): said so, with the way to the day's ten.
  if (name === undefined) return missing();
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
    home: `/almanac/${category}`,
    lead:
      category === mix.id
        ? "Десет въпроса от всички теми, от лесен към труден."
        : "Десет въпроса по темата, от лесен към труден.",
    begin: async () => {
      const s = await api<State>("POST", "/api/topic", { category });
      ask();
      return s;
    },
    left: (l) => l.category === category,
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
            main: () => nextOf(day(), again, category).main,
            also: [() => nextOf(day(), again, category).also],
          },
          just ? [otherTopics(category), news(s.id)] : [otherTopics(category)],
          just,
        ),
      ),
  });
}

/** A topic's result's buttons: „Още десет“, gold; or, while the day's ten wait, the way to them, gold, with the streak
 * at stake under it, and „Още десет“ plain. */
function nextOf(d: DayWaits | null, again: () => void, chapter: string): { main: Child; also: Child[] } {
  if (!d)
    return {
      main: h("button", { class: "btn primary big", onclick: again }, "Още десет"),
      also: [h("a", { class: "btn", href: `/almanac/${chapter}` }, "Към главата")], // its facts, the new ones too
    };
  return {
    main: [h("a", { class: "btn primary big", href: "/" }, "Към въпросите на деня"), stakeLine(d.streak, d.spare)],
    also: [h("button", { class: "btn", onclick: again }, "Още десет")],
  };
}

/** How many other topics a topic's result offers. */
const othersShown = 3;

/** Under a topic's result, a way to another, a tap away (Начало's tiles are a scroll from there): the ones after it in
 * the book's order, so that the game goes round the chapters. */
function otherTopics(current: string): Child {
  const at = Math.max(
    0,
    categories.findIndex((c) => c.id === current),
  );
  const others = [...categories.slice(at + 1), ...categories.slice(0, at)]
    .filter((c) => c.id !== current)
    .slice(0, othersShown);
  return () =>
    h(
      "nav",
      { class: "other-topics", "aria-label": "Друга тема" },
      h("p", { class: "kicker" }, "Друга тема"),
      h(
        "ul",
        { class: "chips" },
        others.map((c) =>
          h("li", null, h("a", { class: `chip ${toneOf(c.id)}`, href: `/play/${c.id}` }, topicMark(c.id), c.name)),
        ),
      ),
    );
}

/** The day's ten, while they wait for the player: the streak (to yesterday) and whether the week would forgive a day
 * missed. */
interface DayWaits {
  streak: number;
  spare: boolean;
}

/** Whether the day's ten still wait for the player (null once played), from Начало's state. */
async function dayWaits(): Promise<DayWaits | null> {
  const t = await api<{ streak: number; spare?: boolean; run: State | null }>("GET", "/api/day");
  return t.run?.done ? null : { streak: t.streak, spare: t.spare ?? true };
}

/** A game of a topic the player left unfinished today (play.Left): how far it got, and whether its question is
 * showing, its time running. */
export interface LeftRun {
  id: number;
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
 * (`begin`: a new one, or the one left today), which of the games left today it is (`left`), and what its end draws
 * (`finished`: `again` plays another, `just` says it was played this moment, so its news is told). */
interface Run {
  name: string;
  lead: string;
  /** Where „Откажи“ on the count goes back to, if not where the game was opened from: its chapter. */
  home: string;
  begin: () => Promise<State>;
  left: (l: LeftRun) => boolean;
  finished: (s: State, again: () => void, just: boolean) => Child;
}

/** Plays a topic's run. Opened by a tap, it starts after a short count, which the player can cut
 * short or back out of (back where they came from, or to its start come from outside); come to otherwise (a reload, back or forward, a link from outside),
 * nothing starts by itself: the screen says what it is, or where it was left, with „Започни“ or „Продължи“. A game
 * finished here shows its result again; one whose question this tab was showing goes straight back to it, its time
 * running (as one opened by a tap does). */
function run(r: Run): Child {
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  // What „Откажи“ on the count comes back to in a game opened from outside (its own entry held over Начало): the
  // screen's start, in place (router.ts, backOut).
  let startHere = async () => {};
  const ready = () => {
    hold();
    screen.show(() => getReady(r.name, start, () => backOut(r.home, () => void startHere())));
  };
  // Another from a result starts at once: the player is ready.
  const again = () => {
    hold();
    start();
  };
  const play = (s: State) => screen.show(() => playRun(s, (end) => r.finished(end, again, true)));
  // What comes back once the screen is gone (another page opened meanwhile) does nothing: a game's entry held over
  // that page, or its entry marked, would be another page's.
  const life = lifetime();
  const start = async () => {
    screen.show(starting);
    try {
      await player();
      const s = await r.begin();
      if (!life.aborted) play(s);
    } catch (err) {
      if (life.aborted) return;
      screen.show(() =>
        h(
          "div",
          { class: "stack" },
          h("p", { role: "alert" }, errorText(err)),
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
      if (life.aborted) return;
      if (s?.done) return screen.show(() => r.finished(s, again, false));
      mark({ result: undefined });
    }
    const left = (await loadLeft().catch(() => [])).find(r.left);
    if (life.aborted) return;
    // Its question showing, its time running: straight back in, where that tab was showing it or a tap asked.
    if (left?.open && (tap || shownHere(left.id))) {
      const s = await api<State>("GET", `/api/runs/${left.id}`).catch(() => null);
      if (life.aborted) return;
      if (s && !s.done) return play(s);
    }
    startHere = async () => {
      const marks = left ? (await api<State>("GET", `/api/runs/${left.id}`).catch(() => null))?.trail : undefined;
      if (life.aborted) return;
      screen.show(() =>
        startScreen(r.name, r.lead, left ? { at: left.at, total: left.total, marks } : null, () =>
          left?.open ? start() : ready(),
        ),
      );
    };
    if (tap) return ready();
    await startHere();
  })();
  return h("div", null, screen);
}
