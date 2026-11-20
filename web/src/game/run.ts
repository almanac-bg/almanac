// Playing a run: a question, its answer, and on by itself to the next, to the end. The server keeps the clock and
// the score; this shows them. What's behind each answer („Знаеше ли?“) and a word about a question wait for the
// end, so that the game flows.
//
// A run is a game under way from its count to its end: it has an entry of its own in the tab's history if its page has
// none behind it in the app (router.ts, hold), so that back comes to the question's guard; at its end the entry goes
// and the page keeps its result (a reload or a back to it shows the result again, not a new count). A question's time
// runs on the server: come back to it on the device that showed it (a reload), the run goes straight back in; on
// another device (or tab), the screen waits for „Продължи“.
// A question given up by leaving shows its answer and fact once the run comes back, on this device, before the
// next one: what the player missed, without points.

import { type ApiError, api, tries } from "../lib/api.ts";
import { append, type Child, computed, effect, h, listen, onCleanup, type Signal, signal, slot } from "../lib/dom.ts";
import { calm, tickOn } from "../lib/prefs.ts";
import { beforeLeaving, hold, release } from "../lib/router.ts";
import { play, playAnswer, playCount } from "../lib/sound.ts";
import { issueOf } from "../lib/words.ts";
import { playingWhile } from "../state.ts";
import {
  chapterName,
  chip,
  fact,
  failure,
  filed,
  glyph,
  inRowChip,
  leaf,
  reachable,
  type VerdictKind,
  verdict,
} from "../ui.ts";
import { answering, liveRegion, type Say, spokenVerdict } from "./answering.ts";
import { inRowOf } from "./numbers.ts";
import { answered, beats, crowdLine, picture, picturesIn, type Stage } from "./questions.ts";
import type { Answer, Credit, Mark, Result, Reveal, Shown, State, TheirMark, View } from "./types.ts";

/** Where the run whose question this tab showed last is kept (this tab's, for as long as it's open). */
const showingKey = "almanac.showing";

/** Whether this tab showed the run's question last: a reload goes straight back into it, its time running; another
 * device or tab waits for a tap. */
export function shownHere(run: number): boolean {
  try {
    return sessionStorage.getItem(showingKey) === String(run);
  } catch {
    return false;
  }
}

function showing(run: number): void {
  try {
    sessionStorage.setItem(showingKey, String(run));
  } catch {
    // no storage here: a reload waits for „Продължи“
  }
}

/** Plays a run from where it stands; `done` draws what comes after its last answer. A duel is named over each
 * question as its page names it (`versus`: „Дуел с Мария“, „Срещу запис на Мария“); played second (the run's
 * `against`), the other's answer (`them`, their name) shows as they gave it: a word at the moment they did, and how it
 * went once the player's own is in. */
export function playRun(initial: State, done: (s: State) => Child, versus = "", them = ""): Child {
  const screen = slot();
  hold();

  // A step of the run that doesn't get through (no line, the server restarting) is tried again quietly, a few times;
  // then it says so in the run's own frame (its head, its arrow out, its pips), and goes on as the line comes back.
  // Once the run's screen is gone, a step on its way (a reply come late, a retry as the line comes back) does nothing:
  // it would draw into a screen nobody sees, or take the history's entry of another page.
  let last = initial;
  const stuck = (err: unknown, retry: () => void) => {
    if (!gone) screen.show(() => stuckAt(last, err, retry));
  };
  const next = async () => {
    if (gone) return;
    try {
      at(await tries(() => api<State>("POST", `/api/runs/${initial.id}/show`, {})));
    } catch (err) {
      stuck(err, next);
    }
  };
  // A question with pictures waits for them, its time with it (the server starts it by itself if they take too long):
  // it shows once they're in, its time starting then.
  const start = async (q: Shown) => {
    await picturesIn(q.view, q.startsMs ?? 0);
    if (gone) return;
    try {
      at(await tries(() => api<State>("POST", `/api/runs/${initial.id}/start`, { n: q.n })));
    } catch (err) {
      stuck(err, () => start(q));
    }
  };
  const reload = async () => {
    if (gone) return;
    try {
      at(await tries(() => api<State>("GET", `/api/runs/${initial.id}`)));
    } catch (err) {
      stuck(err, reload);
    }
  };
  // A question opens only while the page is in view: its time would otherwise run unseen.
  let seen: (() => void) | null = null;
  const whenSeen = (fn: () => void) => {
    if (!document.hidden) return fn();
    seen = () => {
      if (document.hidden || !seen) return;
      document.removeEventListener("visibilitychange", seen);
      seen = null;
      fn();
    };
    document.addEventListener("visibilitychange", seen);
  };
  let gone = false;
  onCleanup(() => {
    gone = true;
    if (seen) document.removeEventListener("visibilitychange", seen);
  });
  // Under way until its end shows.
  const over = signal(initial.done);
  playingWhile(() => !over());

  // Where the run stands: its end, a question waiting for its pictures, a question showing, or between questions
  // (the next one opens at once). A question and the end open at the top of the page, not where the answer before
  // them (its fact, „Напред“) was scrolled to.
  const at = (s: State) => {
    if (gone) return;
    last = s;
    over.set(s.done);
    if (s.done) {
      release({ result: s.id });
      screen.show(() => done(s));
      scrollTo(0, 0);
    } else if (s.question?.startsMs) {
      const q = s.question;
      whenSeen(() => start(q));
    } else if (s.question) {
      const q = s.question;
      showing(s.id);
      screen.show(() =>
        question(s, q, next, reload, versus, say, them, (now) => {
          last = now;
        }),
      );
      scrollTo(0, 0);
    } else whenSeen(next);
  };

  // What a screen reader says as the run goes (an answer's verdict, a clue come out): one live region for the whole
  // run (answering.ts).
  const { node: region, say } = liveRegion();

  // Back to a run whose last question was given up by leaving: that question's answer first, then on.
  const left = takeGivenUp(initial.id);
  if (left && !initial.done && !initial.question) screen.show(() => givenUp(left, initial.total, () => at(initial)));
  else at(initial);
  return h("div", { class: "run" }, region, screen);
}

/** Where a question given up by leaving is kept, on this device, until its run comes back: what to show of it then. */
const givenUpKey = "almanac.givenUp";

interface GivenUp {
  run: number;
  n: number;
  category: string;
  view: View;
  reveal: Reveal;
}

function keepGivenUp(run: number, q: Shown, reveal: Reveal): void {
  try {
    localStorage.setItem(givenUpKey, JSON.stringify({ run, n: q.n, category: q.category, view: q.view, reveal }));
  } catch {
    // no storage here: it's in the game's review all the same
  }
}

/** The question given up in a run, if any, taken: it shows once. */
function takeGivenUp(run: number): GivenUp | null {
  try {
    const g = JSON.parse(localStorage.getItem(givenUpKey) ?? "null") as GivenUp | null;
    if (g?.run !== run) return null;
    localStorage.removeItem(givenUpKey);
    return g;
  } catch {
    return null;
  }
}

/** A question given up by leaving, as the run comes back: what it asked, its answer marked, the fact behind it, and
 * the way on. No points: it's what was missed. */
function givenUp(g: GivenUp, total: number, on: () => void): Child {
  const go = h("button", { class: "btn primary big", type: "button", onclick: on }, "Напред");
  requestAnimationFrame(() => {
    if (go.isConnected) go.focus({ preventScroll: true });
  });
  return h(
    "article",
    { class: "question given-up" },
    h("p", { class: "kicker" }, `Въпрос ${g.n + 1} от ${total} · ${topicName(g.category)}`),
    h("p", { class: "muted" }, "Излезе, без да отговориш. Ето верния отговор."),
    h("h1", { class: "ask" }, g.view.text),
    picture(g.view),
    answered(g.view, g.reveal, null),
    fact(g.reveal.fact, g.reveal.day),
    go,
  );
}

/** Before a run: three seconds to settle in, a ring running out around them, with a way back out (also Esc) and
 * a way to start at once. Each second beeps; the start an octave higher. The game has the whole screen from here (on
 * a phone, the header and the bar of places step aside), and keeps it while its first question comes (starting, in
 * its place): should none come (it failed to start), the screen is given back with what shows instead. */
export function getReady(what: string, start: () => void, cancel: () => void): Child {
  const seconds = 3;
  const left = signal(seconds);
  let gone = false;
  const leave = (fn: () => void) => {
    if (gone) return;
    gone = true;
    clearInterval(tick);
    fn();
  };
  const begin = () =>
    leave(() => {
      play("go");
      start();
    });
  const tick = setInterval(() => {
    left.update((n) => n - 1);
    if (left.peek() <= 0) begin();
    else playCount(left.peek());
  }, 1000);
  playingWhile();
  onCleanup(() => clearInterval(tick));
  playCount(seconds);
  listen(document, "keydown", (e) => {
    if (e.key === "Escape") leave(cancel);
    // Enter starts, unless it's pressing a button of its own.
    else if (e.key === "Enter" && !(e.target as Element).closest?.("button:enabled, a")) begin();
  });

  return h(
    "div",
    { class: "screen get-ready" },
    h("div", { class: "intro" }, h("p", { class: "kicker" }, what), h("h1", null, "Приготви се")),
    readyClock(seconds * 1000, left),
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        { class: "btn primary big", onclick: begin },
        "Започни сега",
        h("kbd", { class: "key-hint", "aria-hidden": "true" }, "Enter"),
      ),
      h(
        "button",
        { class: "btn", onclick: () => leave(cancel) },
        "Откажи",
        h("kbd", { class: "key-hint", "aria-hidden": "true" }, "Esc"),
      ),
    ),
  );
}

/** A game's first question on its way, once its count has run (its run being made, the player first if need be): the
 * game keeps the whole screen meanwhile (playingWhile), and gives it back if what shows next isn't the game. */
export function starting(): Child {
  playingWhile();
  return h("p", { class: "muted" }, "…");
}

/** A game come to without a tap (a reload, back or forward, a link from outside): nothing starts by itself. What it is
 * (`what`, `lead`), where it stopped if it was left half-way (`left`: its pips, and the next question), and the gold
 * button that starts it (its count) or goes on with it (`button`, if it says another word). */
export function startScreen(
  what: string,
  lead: string,
  left: { at: number; total: number; marks?: Mark[] } | null,
  start: () => void,
  button = left ? "Продължи" : "Започни",
): Child {
  const go = h("button", { class: "btn primary big", type: "button", onclick: start }, button);
  return h(
    "div",
    { class: "screen get-ready start-screen" },
    h(
      "div",
      { class: "intro" },
      h("h1", null, what),
      h("p", { class: "lead" }, left ? `Следва въпрос ${left.at + 1} от ${left.total}.` : lead),
    ),
    left?.marks ? trail(left.marks, left.total, left.at) : null,
    h("div", { class: "actions" }, go),
  );
}

/** The seconds before a start, big, in a ring that runs out with them (in CSS, over the same time, like a question's
 * time bar): before a run. `ms` is the time to the start, `left` the whole seconds
 * still to go. */
export function readyClock(ms: number, left: () => number): Child {
  const ring = svg("svg", { class: "ready-ring", viewBox: "0 0 120 120", "aria-hidden": "true" });
  const circle = (cls: string) => svg("circle", { class: cls, cx: 60, cy: 60, r: 52, pathLength: 100 });
  ring.append(circle("ready-track"), circle("ready-arc"));
  ring.style.setProperty("--ready", `${ms}ms`);
  return h(
    "div",
    { class: "ready-clock", role: "timer", "aria-label": () => `Започва след ${Math.max(1, left())} с` },
    ring,
    h("b", { class: "ready-n" }, () => String(Math.max(1, left()))),
  );
}

function svg(name: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** A run that couldn't take its next step: in its own frame (the head with its arrow out, the pips), what went wrong
 * and „Опитай пак“, tried again by itself as the line comes back. */
function stuckAt(s: State, err: unknown, retry: () => void): Child {
  return h(
    "article",
    { class: "question run-question" },
    h("div", { class: "question-top" }, questionHead(s.at, s.total, ""), trail(s.trail, s.total, s.at)),
    failure(err, retry, wayOut(err)),
  );
}

/** Where a run that can't go on leads: a day's run past its day (play.ErrDayOver), to Начало and today's questions;
 * otherwise nowhere but the run's own arrow out. */
function wayOut(err: unknown): [href: string, label: string] | null {
  return (err as ApiError).code === "day_over" ? ["/", "Към Днес"] : null;
}

/** A run's progress: a pip for each question, marked by how it went (and the one being asked, if any). */
export function trail(marks: Mark[], total: number, now = -1): HTMLElement {
  const words: Record<string, string> = { right: "вярно", partial: "близо", wrong: "грешно", void: "не се брои" };
  return h(
    "ol",
    { class: "trail", "aria-label": `${marks.length} от ${total} въпроса` },
    Array.from({ length: total }, (_, i) => {
      const m = marks[i];
      const how = !m ? (i === now ? "now" : "") : m.void ? "void" : m.right ? "right" : m.close ? "partial" : "wrong";
      return h("li", { class: how || undefined, title: how && how !== "now" ? `${i + 1}: ${words[how]}` : null });
    }),
  );
}

const topicName = chapterName;

/** While leaving would cost the player something (`costs`: a question with its time running),
 * every way out (a link, back, the game's arrow) first asks, in a sheet over the game at the screen's foot: what it
 * costs (`text`), „Остани“ (gold: playing on is the one right answer) and „Излез“, which does `leave` (given the way
 * on) and goes. Esc stays too. The clock runs on meanwhile, in sight above the sheet. */
export function guardLeaving(
  text: string,
  costs: () => boolean,
  leave: (on: () => void) => void | Promise<void> = (on) => on(),
): Child {
  const asking = signal(false);
  const going = signal(false);
  const now = computed(costs);
  let proceed: (() => void) | null = null;
  const stay = h("button", { class: "btn primary", type: "button", onclick: () => keep() }, "Остани");
  onCleanup(
    beforeLeaving((on) => {
      if (!now()) return false;
      proceed = on;
      asking.set(true);
      requestAnimationFrame(() => stay.focus({ preventScroll: true }));
      return true;
    }),
  );
  const keep = () => {
    proceed = null;
    asking.set(false);
  };
  const go = async () => {
    const on = proceed;
    if (!on || going.peek()) return;
    going.set(true);
    await leave(on);
  };
  listen(document, "keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape" && asking()) keep();
  });
  return h(
    "div",
    { class: "leave-layer", hidden: () => !asking() || !(now() || going()) },
    h(
      "div",
      { class: "card leave-ask", role: "alertdialog", "aria-modal": "true", "aria-label": "Излизане от играта" },
      h("p", { class: "leave-text" }, text),
      h(
        "div",
        { class: "leave-actions" },
        stay,
        h("button", { class: "btn", type: "button", disabled: going, onclick: go }, "Излез"),
      ),
    ),
  );
}

/** The top of a question: the way out, what's played (the day's issue, or the topic: `aside`; in a duel, with whom:
 * `versus`), the game's tally, and which one of how many. A game has the whole screen, the header with it, so the
 * way out is here: a cross to Днес (on Днес itself too, where the day's ten are played: it opens afresh, the
 * day waiting there), the way back (router.ts): back in the history where Днес is the page before. */
export function questionHead(
  n: number,
  total: number,
  aside: string,
  tally: Child = null,
  versus: Child = null,
): Child {
  return h(
    "header",
    { class: "question-head" },
    h(
      "a",
      { class: "game-leave", href: "/", "data-back": true, "aria-label": "Към Днес", title: "Към Днес" },
      h("span", { class: "i i-close", "aria-hidden": "true" }),
    ),
    h(
      "div",
      { class: "head-side" },
      versus ? h("p", { class: "kicker versus" }, versus) : null,
      h("p", { class: "kicker" }, aside),
    ),
    tally,
    // „4/10“ to the eye, „4 от 10“ read aloud and in the page's words.
    h(
      "p",
      { class: "count" },
      h("b", { class: "count-n" }, String(n + 1)),
      h("span", { class: "count-of" }, h("span", { class: "num-word" }, " от "), String(total)),
    ),
  );
}

/** A run's tally while it's played: the right answers in a row it's on, once there are two. */
function tally(el: HTMLElement, inRow: number) {
  el.replaceChildren(...[inRowChip(inRow)].filter((c): c is HTMLElement => c !== null));
}

/** The time left: a bar that runs out with the seconds beside it, muted, then gold for the last ten seconds and red
 * for the last five, grey once answered. The clock is silent until the last ten seconds: then a soft tick a second,
 * and for the last five a beep a second, a step higher each (a question of ten seconds, „Вярно или невярно“, sounds
 * and turns red only for those five). */
export function timer(leftMs: number, limitMs: number, left: () => number, locked: Signal<boolean>): Child {
  const bar = h("div", { class: "time-bar" });
  bar.style.transform = `scaleX(${leftMs / limitMs})`;
  // The bar runs from where the time is when it first can (a busy first frame starts it late, not behind), to the end.
  const end = performance.now() + leftMs;
  let run: Animation | undefined;
  requestAnimationFrame(() => {
    const rest = Math.max(0, end - performance.now());
    if (locked.peek() || !bar.animate) return;
    run = bar.animate([{ transform: `scaleX(${rest / limitMs})` }, { transform: "scaleX(0)" }], {
      duration: rest,
      easing: "linear",
      fill: "forwards",
    });
  });
  effect(() => {
    const n = left();
    if (n <= 0 || n > 10 || locked.peek() || !tickOn.peek()) return;
    if (n <= 5) play("hurry", 5 - n);
    else if (limitMs > 10_000) play("tick");
  });
  // Once answered, the bar stops where it is.
  const freeze = () => run?.pause();
  return h(
    "div",
    // Quiet while there's time, as the clock's sound is; gold from the last ten seconds, red for the last five.
    {
      class: () => {
        const n = left();
        if (locked()) return "timer stopped";
        if (n <= 5) return "timer low";
        return n <= 10 && limitMs > 10_000 ? "timer soon" : "timer";
      },
    },
    h("div", { class: "track" }, bar),
    h(
      "span",
      { class: "secs", role: "timer", "aria-label": () => `${left()} ${left() === 1 ? "секунда" : "секунди"}` },
      () => String(left()),
      h("small", null, " с"),
    ),
    () => {
      if (locked()) freeze();
      return null;
    },
  );
}

/** How long an answer shows before the game moves on: longer where there's more to read. */
export function pauseFor(view: View): number {
  return view.type === "choice" || view.type === "truefalse" ? 3000 : 4500;
}

/** How long a fact takes to read, unhurried (none for no fact): a little to start, more for each letter, at most nine
 * seconds — whoever reads faster moves on with a tap. */
export function readingTime(text?: string): number {
  return text ? Math.min(9000, 1200 + 45 * text.length) : 0;
}

/** The game moving on by itself: a line that fills while the answer shows (`enter`: and on a computer, that Enter goes
 * on at once). */
export function upNext(ms: number, label: string, enter = false): Child {
  const fill = h("i", { class: "up-next-fill" });
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      fill.style.transition = `transform ${ms}ms linear`;
      fill.style.transform = "scaleX(1)";
    }),
  );
  return h(
    "div",
    { class: "up-next", role: "status" },
    h("span", { class: "up-next-label" }, label, enter ? h("kbd", { class: "key-hint" }, "Enter") : null),
    h("span", { class: "track" }, fill),
  );
}

/** A question of a run, asked and answered; `taken` hears where the run stands once its answer is in. */
function question(
  s: State,
  q: Shown,
  next: () => void,
  reload: () => void,
  versus: string,
  say: Say,
  them: string,
  taken: (now: State) => void,
): Child {
  const problem = slot();
  const after = h("div", { class: "after", hidden: true });
  reachable(after);
  let progress = trail(s.trail, s.total, q.n);
  let over = false; // the question's screen gone
  let leaving = false; // given up by leaving: its answer isn't shown here
  onCleanup(() => {
    over = true;
  });
  // Played second: a word over the question as the other answered it (at the moment they did, as far into its time),
  // and how it went for them once the player's own is in.
  const theirs = them ? s.against?.[q.n] : undefined;
  const theyAnswered = signal(false);
  if (theirs && !theirs.missed) {
    const when = window.setTimeout(
      () => {
        if (ans.locked.peek()) return; // the player's own is in: theirs shows with it
        theyAnswered.set(true);
        play("them");
      },
      Math.max(0, theirs.ms - (q.limitMs - q.leftMs)),
    );
    onCleanup(() => clearTimeout(when));
  }
  const versusNow: Child = theirs ? () => (theyAnswered() ? `${them} отговори` : versus) : versus;
  const score = h("div", { class: "tally" });
  tally(score, inRowOf(s.trail));

  // Moving on, once the answer has shown for a while: never into a question nobody's looking at (a tab in the
  // background), as its time would run unseen.
  let due: (() => void) | null = null;
  let advance = 0;
  const shown: number[] = [];
  const moveOn = () => {
    if (!due || document.hidden) return;
    const go = due;
    due = null;
    go();
  };
  document.addEventListener("visibilitychange", moveOn);
  // The room the answer's panel takes at the screen's foot on a phone (app.css), kept under the question, so that
  // what's above it can always be seen.
  const room = () => page.style.setProperty("--after", `${after.offsetHeight}px`);
  const sized = new ResizeObserver(room);
  sized.observe(after);
  onCleanup(() => {
    clearTimeout(advance);
    for (const t of shown) clearTimeout(t);
    document.removeEventListener("visibilitychange", moveOn);
    sized.disconnect();
  });

  // A step of the answer's showing, `ms` after its first; with less motion, at once.
  const at: Stage = (ms, step) => {
    if (calm.peek()) step();
    else shown.push(window.setTimeout(step, ms));
  };

  // The answer, as every game's goes (answering.ts): once, locked at the tap, sent again quietly a few times while it
  // doesn't get through (the clock running on in sight: it stops once the answer is taken, as the server takes the
  // time it came in), and only then said under the question, with „Опитай пак“ (tried again by itself as the line
  // comes back). When the time is up, whatever has been put in (or nothing) is the answer. What the player chose stays
  // chosen a moment, however quick the line, before the answer shows. Whether it was given within the question's
  // time, by this screen's clock, goes with it, as it was at the first send: the server takes one that was, should
  // the line make it late (play/late.go). The time-up's own send is within it (a timer fires a moment after).
  let held = 0;
  let inTime: boolean | undefined;
  const ans = answering<Result>({
    view: q.view,
    leftMs: q.leftMs,
    post: (answer): Promise<Result> => {
      held ||= answer === null ? 1 : performance.now() + holdMs;
      inTime ??= ans.left.ms() > -1000;
      return api<Result>("POST", `/api/runs/${s.id}/answer`, { n: q.n, answer, inTime });
    },
    open: () => !over,
    tries: 3,
    sendNone: true,
    focus: true,
    say,
    // Out of step with the server (the run moved on elsewhere): where it stands now.
    handles: (err) => {
      if (err.code !== "out_of_step") return false;
      reload();
      return true;
    },
    taken: async (res, answer) => {
      if (leaving) return;
      taken(res.state);
      const wait = held - performance.now();
      if (wait > 0 && !calm.peek()) await new Promise((on) => at(wait, () => on(null)));
      reveal(res, answer);
    },
  });
  const asked = ans.asked;
  effect(() => {
    const p = ans.problem();
    problem.show(() => (p ? failure(p.err, p.retry ?? undefined, wayOut(p.err)) : null));
  });

  // The answer shows in beats (DESIGN.md, Motion): the player's own answer judged, its sound and its pip; the right
  // one (if it wasn't theirs) and the verdict docked at the screen's foot, the tally with them;
  // how everyone else answered; the fact, and the way on. With less motion, all at once.
  const reveal = (res: Result, answer: Answer | null) => {
    // The question's own steps on the right answer's beat (the right one marked) are taken with the panel's, in the
    // same frame, so that the answer comes into place in one movement (settle).
    const marks: (() => void)[] = [];
    asked.reveal(
      res.reveal,
      answer,
      (ms, step) => {
        if (ms === beats.right && !calm.peek()) marks.push(step);
        else at(ms, step);
      },
      kindOf(res, answer) === "partial",
    );
    const now = trail(res.state.trail, s.total);
    now.children[q.n]?.classList.add("fresh");
    progress.replaceWith(now);
    progress = now;
    const kind = kindOf(res, answer);
    playAnswer(kind, res.inRow ?? 0);
    // The fact behind the answer (and on its date, what happened that day), at the moment the player most wants it:
    // time to read it, or a tap to move on. The verdict comes with all that follows it in place, still hidden, so
    // the panel opens once at its height and the answers settle once above it.
    const said = [res.reveal.day, res.reveal.fact].filter(Boolean).join(" ");
    const pause = pauseFor(q.view) + readingTime(said);
    // From the verdict on, the time it stays: the beats to the fact, then the pause.
    const lasts = pause + beats.fact - beats.right;
    let crowd: Child = null;
    let rest: Child[] = [];
    at(beats.right, () => {
      for (const step of marks) step();
      tally(score, res.inRow ?? 0);
      crowd = waiting(crowdLine(q.view.type, res.reveal.crowd, res.right));
      rest = [
        theirLine(them, res.state.against?.[q.n]),
        // Ink, said where it was written: the issue, met there first (the server says; not said, the issue at all).
        res.right && res.reveal.fact && (res.ink ?? s.kind === "day") ? filed(q.category, res.ink) : null,
        fact(res.reveal.fact, res.reveal.day),
        res.reveal.credit ? credit(res.reveal.credit) : null,
        upNext(lasts, res.state.done ? "Към резултата…" : `Въпрос ${q.n + 2} след малко…`, true),
        h(
          "button",
          {
            class: "btn up-next-go",
            type: "button",
            onclick: () => {
              clearTimeout(advance);
              moveOn();
            },
          },
          res.state.done ? "Към резултата" : "Напред",
        ),
      ].map(waiting);
      // The verdict is said once, in plain words, through the run's live region (not its own, made already full, nor
      // anything counting up from nothing).
      const told = verdict(kind, undefined, res.inRow);
      if (told instanceof HTMLElement) told.removeAttribute("role");
      append(after, [told, crowd, ...rest]);
      settle(page, head, after, asked.node, at, () => {
        after.hidden = false;
        page.classList.add("answered");
        room();
      });
      say(spokenVerdict(kind, q.view, res.reveal));
      advance = window.setTimeout(moveOn, lasts);
    });
    at(beats.crowd, () => shows(crowd));
    at(beats.fact, () => {
      for (const part of rest) shows(part);
      // Where answering took the focus away with it (a pad, a list, a deck gone for their answer), it goes to the way
      // on; on an answer chosen, it stays there.
      const focus = document.activeElement;
      if (!focus || focus === document.body || !focus.isConnected || (focus as HTMLElement).offsetParent === null)
        after.querySelector<HTMLElement>(".up-next-go")?.focus({ preventScroll: true });
      // A run's result sounds its own end as it lands (results.ts), a duel's its verdict (screens/outcome.ts).
      due = res.state.done ? reload : next;
    });
  };

  // More of the question shows as its time runs (the next clue): the server sends it when it's due, not before.
  let more = 0;
  const lookAgain = (ms: number) => {
    more = window.setTimeout(async () => {
      if (ans.locked.peek()) return;
      try {
        const now = await api<State>("GET", `/api/runs/${s.id}`);
        if (ans.locked.peek() || now.question?.n !== q.n) return;
        asked.update?.(now.question.view);
        if (now.question.moreMs) lookAgain(now.question.moreMs);
      } catch {
        lookAgain(1000); // a bad moment on the line: once more, soon
      }
    }, ms);
  };
  if (q.moreMs) lookAgain(q.moreMs);
  onCleanup(() => clearTimeout(more));

  // Leaving while the question's time runs would cost it, as the time runs on the server: a way out (the arrow, back,
  // a place in the header) asks first. Leaving gives the question up, so the run waits between two questions, where
  // the player comes back to it („Продължи“). Once the answer is in, leaving costs nothing and asks nothing.
  const leaveAsk = guardLeaving(
    "Ако излезеш сега, въпросът остава без отговор.",
    () => !ans.locked(),
    async (on) => {
      leaving = true;
      // Given up (unless an answer is on its way or in): its time runs out on the server all the same if this
      // doesn't get through.
      const res = await ans.send(null);
      if (res && !res.state.done) keepGivenUp(s.id, q, res.reveal);
      on();
    },
  );

  // Enter, once the answer shows, goes on at once (keys 1–4 answer: questions.ts).
  listen(document, "keydown", (e: KeyboardEvent) => {
    const own = (e.target as Element).closest?.("button:enabled:not([aria-disabled='true']), a, input");
    if (e.key !== "Enter" || !due || e.repeat || own) return;
    e.preventDefault();
    clearTimeout(advance);
    moveOn();
  });

  // On a phone the question is a column the screen's height: the head, the pips and the clock at the top, the
  // question on its chapter's sheet under them, and what answers it at the foot, under the thumb (app.css).
  const topicWords = q.onThisDay ? `${topicName(q.category)} · На този ден` : topicName(q.category);
  const head = stays(
    questionHead(
      q.n,
      s.total,
      s.kind === "day" && s.day ? `Брой ${issueOf(s.day)}` : topicName(s.category ?? q.category),
      score,
      versusNow,
    ),
    progress,
    timer(q.leftMs, q.limitMs, ans.left, ans.stopped),
  );
  const page = h(
    "article",
    { class: `question run-question t-${q.category}` },
    head.node,
    leaf(
      q.category,
      [
        h(
          "div",
          { class: "q-tags" },
          chip(q.category, h("span", { class: "chip-name" }, topicWords)),
          // The day ends on its hard number: said on its sheet.
          s.kind === "day" && q.n === s.total - 1 && q.view.type === "number"
            ? h("span", { class: "hard-tag" }, "Трудното число")
            : null,
        ),
        glyph(q.category, 32, "q-mini"),
        // It takes the focus as it opens, so a screen reader reads it first (no ring for it: app.css, h1).
        ans.heading,
      ],
      "q-leaf",
    ),
    picture(q.view, true),
    h("div", { class: "answering" }, asked.node, problem),
    after,
    leaveAsk,
  );
  return page;
}
/** How a question went for the other side of a duel, as a line under the player's verdict: „Мария: вярно за 4,2 с“.
 * Their mark for it comes with the player's own answer (play.State.Against): none, nothing to say. */
function theirLine(name: string, m: TheirMark | undefined): Child {
  if (!name || !m) return null;
  const secs = (m.ms / 1000).toLocaleString("bg", { maximumFractionDigits: 1 });
  const how = m.right ? `вярно за ${secs} с` : m.close ? "близо" : m.missed ? "без отговор" : "грешно";
  return h("p", { class: `their-line${m.right ? " right" : ""}` }, h("b", null, `${name}: `), how);
}

/** How long what the player chose stays chosen before the answer shows, however quick the line. */
const holdMs = 280;

/** A part of the answer's panel, in its place but not shown yet; and shown. */
function waiting<T extends Child>(part: T): T {
  if (part instanceof HTMLElement) part.classList.add("unseen");
  return part;
}

function shows(part: Child): void {
  if (part instanceof HTMLElement) part.classList.remove("unseen");
}

/** How the answer comes into place: the panel's and the page's one movement (DESIGN.md, Motion). */
const settling = { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };

/** Brings the answer into place, its panel shown by `show`, in one movement. On a phone the panel docks at the
 * screen's foot (app.css: it's fixed there) and the answers move up above it, the page moving just enough that the
 * right answer (or, for an order or pairs, the answer's top) shows between the head and the panel; on a laptop the
 * panel shows beside the question, in sight wherever the page is, and the page moves only if the right answer isn't
 * (back up to the question's first line, if the answering had moved it away); at a tablet's width the panel shows
 * under the answers, and the page moves just enough to show it, short of the question's first line going under the
 * head (but the verdict shows). Where everything ends is worked out
 * first, the page already in its last state and the head at the size it will have there (it stays so meanwhile: a
 * head that changed size as the page moved made it jump), and the page goes there at once; then what moved glides
 * from where it was (a head made smaller, its parts too, from their size then), the panel rising with it, opaque, so
 * the right answer is never under the panel on the way, nor shows through it. The right answer brought up from out
 * of sight pops once it's there. With less motion, it's all simply there. */
function settle(page: HTMLElement, head: Head, after: HTMLElement, answers: Child, at: Stage, show: () => void): void {
  const parts = [...page.children].filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && el !== head.node && el !== after && getComputedStyle(el).display !== "none",
  );
  const first = parts.map((el) => el.getBoundingClientRect().top);
  // The head's own parts, where they are: stuck, it's smaller, and they go there in the same movement.
  const headParts = [...head.node.querySelectorAll<HTMLElement>(".game-leave, .count, .tally, .trail")];
  const headWas = headParts.map((el) => el.getBoundingClientRect());
  const was = scrollY;
  const right = answers instanceof Element ? answers.querySelector("button.option.right") : null;
  // The player's own wrong answer stays in sight with the right one: the two rows a choice keeps (app.css).
  const mine = answers instanceof Element ? answers.querySelector("button.option.wrong") : null;
  const key = right ?? (answers instanceof Element ? answers : after);
  const keyWas = key.getBoundingClientRect().top;
  // What has to stay in sight: the right answer, and the player's own beside it.
  const keyBox = () => {
    const a = key.getBoundingClientRect();
    const b = mine?.getBoundingClientRect();
    if (!b || !right) return a;
    const top = Math.min(a.top, b.top);
    const bottom = Math.max(a.bottom, b.bottom);
    return { top, bottom, height: bottom - top };
  };
  show();
  // The docked panel leaves room for them over it, however tall (app.css), as they are once answered.
  if (right) page.style.setProperty("--keep", `${Math.ceil(keyBox().height)}px`);
  // Docked at a phone's foot (fixed), beside the question on a laptop (sticky, in its own column), or under it.
  const place = getComputedStyle(after).position;
  const docked = place === "fixed";
  const beside = place === "sticky";
  const ask = page.querySelector(".ask") ?? key;
  const go = after.querySelector<HTMLElement>(".up-next-go");
  // The verdict's foot as it's laid out, not as it's drawn coming in (app.css: .after > *, enter).
  const verdict = after.firstElementChild instanceof HTMLElement ? after.firstElementChild : after;
  const told = () =>
    after.getBoundingClientRect().top +
    verdict.offsetTop -
    (verdict.offsetParent === after ? 0 : after.offsetTop) +
    verdict.offsetHeight;
  // What has to show between the head's foot and the bottom, and how far the page moves down (or up) for it. Docked:
  // the right answer above the panel, its top never under the head. Beside: the right answer above the screen's foot,
  // its top never under the head, and the question's first line too where it fits (the panel shows wherever the page
  // is). Under the answers: the panel, to the screen's foot, but never the question's first line under the head
  // (what doesn't fit is a scroll away, „Напред“ at the screen's foot meanwhile, app.css), and always the verdict,
  // over „Напред“.
  const by = (headFoot: number) => {
    const box = docked || beside ? keyBox() : after.getBoundingClientRect();
    const foot = docked ? after.getBoundingClientRect().top - 12 : innerHeight - 16;
    const below = box.bottom - foot;
    const room = (top: number) => top - headFoot - 12;
    const above = room(docked ? box.top : ask.getBoundingClientRect().top);
    if (beside) return below > 0 ? Math.max(0, Math.min(below, room(box.top))) : Math.min(0, Math.max(above, below));
    const least = docked ? 0 : told() - (foot - (go ? go.offsetHeight + 12 : 0));
    if (below > 0) return Math.max(0, least, Math.min(below, above));
    return above < 0 ? Math.max(above, below) : 0;
  };
  const most = Math.max(0, document.documentElement.scrollHeight - innerHeight);
  const to = (d: number) => Math.round(Math.min(Math.max(was + d, 0), most));
  head.hold(true);
  // The head's foot where it is, while it isn't stuck (it moves with the page); if the page moves past it, it's
  // stuck, and smaller, and its foot is the bottom of what's left of it at the screen's top.
  let y = to(by(head.node.getBoundingClientRect().bottom));
  if (head.stuckAt(y - was)) {
    head.stick(true);
    y = to(by(head.node.offsetHeight - 1));
  }
  head.stick(head.stuckAt(y - was));
  if (y !== was) scrollTo({ top: y, behavior: "instant" });
  // Where the right answer ends, taken before anything glides: once it does, its box is where it's drawn on the way.
  const keyAt = key.getBoundingClientRect();
  at(settling.duration, () => head.hold(false));
  if (calm.peek()) return;
  // From where it was, each part that moved glides to where it is; the panel, new, rises with the answers (from a
  // little below its place if they didn't move); on a big screen it comes with the page.
  let rise = 0;
  parts.forEach((el, i) => {
    const dy = (first[i] ?? 0) - el.getBoundingClientRect().top;
    rise = Math.max(rise, dy);
    if (Math.abs(dy) >= 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], settling);
  });
  // A head made smaller (stuck) has its count, tally, pips and arrow go from where they were, at their size then.
  headParts.forEach((el, i) => {
    const [a, b] = [headWas[i], el.getBoundingClientRect()];
    if (!a || !b.width || !b.height) return;
    const [dx, dy, sx, sy] = [a.left - b.left, a.top - b.top, a.width / b.width, a.height / b.height];
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
    const from = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    el.animate(
      [
        { transform: from, transformOrigin: "0 0" },
        { transform: "none", transformOrigin: "0 0" },
      ],
      settling,
    );
  });
  // The panel, opaque, slides: it never shows the answers through it.
  if (docked || beside)
    after.animate(
      [{ transform: `translateY(${beside ? 16 : Math.max(24, rise)}px)` }, { transform: "none" }],
      settling,
    );
  else if (y !== was) after.animate([{ transform: `translateY(${y - was}px)` }, { transform: "none" }], settling);
  // The right answer's pop waits for it to arrive where it shows, when it comes from far.
  if (Math.abs(keyWas - keyAt.top) > keyAt.height / 2) {
    const pops = key.getAnimations().filter((a) => a instanceof CSSAnimation && a.animationName === "pop");
    for (const a of pops) a.pause();
    at(settling.duration, () => {
      for (const a of pops) a.play();
    });
  }
}

/** A run's head (stays). */
interface Head {
  node: HTMLElement;
  /** Holds it as it is (or lets it go): it doesn't change size while the answer comes into place. */
  hold(on: boolean): void;
  /** Makes it stuck, and smaller, or not. */
  stick(on: boolean): void;
  /** Whether the page moved by `dy` from where it is would have it stuck. */
  stuckAt(dy: number): boolean;
}

/** The top of a question (its count, topic and tally, the pips and the clock), kept in view at the top of the screen
 * while the question and its answer scroll, and smaller there. The room it gives up stays as a margin, so nothing
 * under it jumps. It's stuck once the page has moved a few pixels past it, and comes back only near the page's top:
 * a page moving by a pixel or two at the edge doesn't make it flicker. On a short screen (a phone on its side,
 * app.css: --small) it's small from the start, or from when the phone is turned, with no room kept. */
function stays(...parts: Child[]): Head {
  const node = h("div", { class: "question-top" }, parts);
  let held = false;
  let small = false;
  const stuck = () => node.classList.contains("stuck");
  const stick = (on: boolean) => {
    if (on === stuck() || (small && !on)) return;
    if (!on) {
      node.classList.remove("stuck");
      node.style.marginBottom = "";
      return;
    }
    // Smaller, measured with its whole height still kept below it: the page is never shorter for a moment, which
    // on a page only a little taller than the screen could pull the scroll back up, out from under the finger.
    const tall = node.offsetHeight;
    node.style.marginBottom = `${tall}px`;
    node.classList.add("stuck");
    node.style.marginBottom = small ? "" : `${tall - node.offsetHeight}px`;
  };
  // Where its top would be, were it not stuck: the question's, which nothing above moves.
  const edge = () => node.parentElement?.getBoundingClientRect().top ?? 0;
  const stuckAt = (dy: number) => small || edge() - dy < (stuck() ? -2 : -8);
  const check = () => {
    if (!held && node.isConnected) stick(stuckAt(0));
  };
  // Small or not, read again as the screen changes (a phone turned): its old size, room kept or not, let go first.
  const measure = () => {
    const was = small;
    small = node.isConnected && getComputedStyle(node).getPropertyValue("--small").trim() === "1";
    if (small !== was && stuck() && !held) {
      node.classList.remove("stuck");
      node.style.marginBottom = "";
    }
    check();
  };
  requestAnimationFrame(measure);
  listen(window, "scroll", check, { passive: true });
  listen(window, "resize", measure);
  return {
    node,
    hold: (on) => {
      held = on;
      check();
    },
    stick,
    stuckAt,
  };
}

function kindOf(r: Result, given: Answer | null): VerdictKind {
  if (r.timedOut || given === null) return "time";
  if (r.exact) return "exact";
  if (r.right) return "right";
  return r.score > 0 ? "partial" : "wrong";
}

function credit(c: Credit): Child {
  return h(
    "p",
    { class: "credit" },
    "Снимка: ",
    h("a", { href: c.source, target: "_blank", rel: "noopener" }, c.credit),
    " · ",
    c.licenseUrl ? h("a", { href: c.licenseUrl, target: "_blank", rel: "noopener" }, c.license) : c.license,
  );
}
