// A chapter's game: its questions, as many as you like, shaped by how well you know the chapter. Everyone plays
// the same game. It's started from its chapter in the Алманах („Играй 10 въпроса“); a run of one is /play/<chapter>, whose
// result has one action (the day's ten while they wait, else ten more at once) and the rest as quiet links: ten more,
// its questions gone over, the way back to its chapter.

import { news } from "../game/news.ts";
import { summary } from "../game/results.ts";
import { getReady, playRun, shownHere, starting, startScreen } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { api, errorText } from "../lib/api.ts";
import { type Child, h, lifetime, signal, slot } from "../lib/dom.ts";
import { backOut, byTap, entry, hold, mark, title } from "../lib/router.ts";
import { chapters, player, user } from "../state.ts";
import { stakeLine } from "../ui.ts";
import { missing } from "./missing.ts";

export function chapter([id = ""]: string[]) {
  const name = chapters.find((c) => c.id === id)?.name;
  // A chapter the game doesn't have (an old link, a chapter renamed): said so, with the way to the day's ten.
  if (name === undefined) return missing();
  title(name);
  // While the day's ten wait, a chapter's result points to them (the habit comes first), with the streak at stake.
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
    chapter: id,
    home: `/almanac/${id}`,
    lead: "Десет въпроса от темата, от лесен към труден.",
    begin: async () => {
      const s = await api<State>("POST", "/api/chapter", { chapter: id });
      ask();
      return s;
    },
    left: (l) => l.chapter === id,
    finished: (s, again, just) =>
      h(
        "div",
        { class: "screen" },
        // What was played, where the day's result has its date: every result laid out the same. (The day's state is
        // in long before a game ends: as it was then, never drawing the result again.)
        // The chapter's sheet: its chip, the score and its tiles; under it where the game wrote, with no number (grey
        // is never counted: DECISIONS.md).
        summary(
          s,
          null,
          {
            main: () => nextOf(day(), again, id).main,
            also: [() => nextOf(day(), again, id).also],
            quiet: true,
          },
          [h("p", { class: "news-met" }, "Фактите от играта са в твоя Алманах, в сиво."), just ? news(s.id) : null],
          just,
          id,
        ),
      ),
  });
}

/** A chapter game's result's ways on. While the day's ten wait, the way to them is the one action (the habit comes
 * first), the streak at stake under it, and „Още десет въпроса“ a quiet link beside the way back; once the day is
 * played, „Още десет въпроса“ is the action, and the way back is to the chapter. */
function nextOf(d: DayWaits | null, again: () => void, chapter: string): { main: Child; also: Child[] } {
  const book = h("a", { class: "link tap", href: `/almanac/${chapter}` }, "Към темата");
  if (!d) return { main: h("button", { class: "btn primary big", onclick: again }, "Още десет въпроса"), also: [book] };
  return {
    main: [h("a", { class: "btn primary big", href: "/" }, "Към днешния брой"), stakeLine(d.streak, d.spare)],
    also: [h("button", { class: "link tap", onclick: again }, "Още десет въпроса"), book],
  };
}

/** The day's ten, while they wait for the player: the streak (to yesterday) and whether the week would forgive a day
 * missed. */
interface DayWaits {
  streak: number;
  spare: boolean;
}

/** Whether the day's ten still wait for the player (null once played), from Днес's state. */
async function dayWaits(): Promise<DayWaits | null> {
  const t = await api<{ streak: number; spare?: boolean; run: State | null }>("GET", "/api/day");
  return t.run?.done ? null : { streak: t.streak, spare: t.spare ?? true };
}

/** A game of a chapter the player left unfinished today (play.Left): how far it got, and whether its question is
 * showing, its time running. */
export interface LeftRun {
  id: number;
  chapter: string;
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
  /** The chapter it's of (Микс, България too): its start on the chapter's sheet. */
  chapter: string;
  lead: string;
  /** Where „Отказ“ on the count goes back to, if not where the game was opened from: its chapter. */
  home: string;
  begin: () => Promise<State>;
  left: (l: LeftRun) => boolean;
  finished: (s: State, again: () => void, just: boolean) => Child;
}

/** Plays a chapter's run. Opened by a tap, it starts after a short count, which the player can cut
 * short or back out of (back where they came from, or to its start come from outside); come to otherwise (a reload, back or forward, a link from outside),
 * nothing starts by itself: the screen says what it is, or where it was left, with „Започни“ or „Продължи“. A game
 * finished here shows its result again; one whose question this tab was showing goes straight back to it, its time
 * running (as one opened by a tap does). */
function run(r: Run): Child {
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  // What „Отказ“ on the count comes back to in a game opened from outside (its own entry held over Днес): the
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
        startScreen(
          r.name,
          r.lead,
          left ? { at: left.at, total: left.total, marks } : null,
          () => (left?.open ? start() : ready()),
          undefined,
          r.chapter,
        ),
      );
    };
    if (tap) return ready();
    await startHere();
  })();
  return h("div", null, screen);
}
