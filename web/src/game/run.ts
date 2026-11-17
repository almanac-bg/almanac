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

import { type ApiError, api } from "../lib/api.ts";
import { append, type Child, computed, effect, h, listen, onCleanup, type Signal, signal, slot } from "../lib/dom.ts";
import { calm, tickOn } from "../lib/prefs.ts";
import { beforeLeaving, hold, release } from "../lib/router.ts";
import { play, playAnswer, playCount } from "../lib/sound.ts";
import { withName } from "../lib/words.ts";
import { categories, playing } from "../state.ts";
import {
  countUp,
  fact,
  failure,
  formatNumber,
  inRowChip,
  passing,
  type VerdictKind,
  verdict,
  verdictWords,
} from "../ui.ts";
import { answered, ask, beats, crowdLine, picture, picturesIn, type Stage, spokenAnswer } from "./questions.ts";
import type { Answer, Credit, Mark, Result, Reveal, Shown, State, View } from "./types.ts";

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

/** Plays a run from where it stands; `done` draws what comes after its last answer. A duel with a friend names them
 * (`opponent`) over each question. */
export function playRun(initial: State, done: (s: State) => Child, opponent = ""): Child {
  const screen = slot();
  hold();

  // A step of the run that doesn't get through (no line, the server restarting) is tried again quietly, a few times;
  // then it says so in the run's own frame (its head, its arrow out, its pips), and goes on as the line comes back.
  let last = initial;
  const stuck = (err: unknown, retry: () => void) => screen.show(() => stuckAt(last, err, retry));
  const next = async () => {
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
    playing.set(false);
  });

  // Where the run stands: its end, a question waiting for its pictures, a question showing, or between questions
  // (the next one opens at once). A question and the end open at the top of the page, not where the answer before
  // them (its fact, „Напред“) was scrolled to.
  const versus = opponent ? `Дуел ${withName(opponent)}` : "";
  const at = (s: State) => {
    last = s;
    playing.set(!s.done);
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
        question(s, q, next, reload, versus, say, (now) => {
          last = now;
        }),
      );
      scrollTo(0, 0);
    } else whenSeen(next);
  };

  // What a screen reader says as the run goes (an answer's verdict, a clue come out): one live region for the whole
  // run, there from its start and empty until it speaks, as screen readers reliably read only such a one.
  const region = h("p", { class: "sr", role: "status" });
  let speaking = 0;
  const say = (text: string) => {
    region.textContent = "";
    clearTimeout(speaking);
    speaking = window.setTimeout(() => {
      region.textContent = text;
    }, 60);
  };
  onCleanup(() => clearTimeout(speaking));

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

/** Says something to a screen reader, in the run's live region. */
type Say = (text: string) => void;

/** Before a run: three seconds to settle in, a ring running out around them, with a way back out (also Esc) and
 * a way to start at once. Each second beeps; the start an octave higher. The game has the whole screen from here (on
 * a phone, the header and the bar of places step aside), and keeps it while its first question comes: should none
 * come (it failed to start), the screen is given back. */
export function getReady(what: string, start: () => void, cancel: () => void): Child {
  const seconds = 3;
  const left = signal(seconds);
  let gone = false;
  let began = false;
  const leave = (fn: () => void) => {
    if (gone) return;
    gone = true;
    clearInterval(tick);
    fn();
  };
  const begin = () =>
    leave(() => {
      began = true;
      play("go");
      start();
    });
  const tick = setInterval(() => {
    left.update((n) => n - 1);
    if (left.peek() <= 0) begin();
    else playCount(left.peek());
  }, 1000);
  playing.set(true);
  onCleanup(() => {
    clearInterval(tick);
    if (!began) return playing.set(false);
    window.setTimeout(() => {
      if (!document.querySelector(".run")) playing.set(false);
    }, 1500);
  });
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
 * time bar): before a run, and as a live duel's two are shown. `ms` is the time to the start, `left` the whole seconds
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

/** Calls the server, and again, twice more, a moment apart, while it doesn't get through for a reason that passes (no
 * line, the server restarting): a run's step lost to a moment offline goes on unseen. */
async function tries<T>(call: () => Promise<T>): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await call();
    } catch (err) {
      if (n >= 3 || !passing(err)) throw err;
    }
    await new Promise((on) => setTimeout(on, 800 * n));
  }
}

/** A run that couldn't take its next step: in its own frame (the head with its arrow out, the pips), what went wrong
 * and „Опитай пак“, tried again by itself as the line comes back. */
function stuckAt(s: State, err: unknown, retry: () => void): Child {
  return h(
    "article",
    { class: "question run-question" },
    h("div", { class: "question-top" }, questionHead(s.at, s.total, ""), trail(s.trail, s.total, s.at)),
    failure(err, retry, null),
  );
}

/** A run's progress: a pip for each question, marked by how it went (and the one being asked, if any). */
export function trail(marks: Mark[], total: number, now = -1): HTMLElement {
  const words: Record<string, string> = { right: "вярно", partial: "близо", wrong: "грешно" };
  return h(
    "ol",
    { class: "trail", "aria-label": `${marks.length} от ${total} въпроса` },
    Array.from({ length: total }, (_, i) => {
      const m = marks[i];
      const how = !m ? (i === now ? "now" : "") : m.right ? "right" : m.partial ? "partial" : "wrong";
      return h("li", { class: how || undefined, title: how && how !== "now" ? `${i + 1}: ${words[how]}` : null });
    }),
  );
}

const topicName = (id: string) => categories.find((c) => c.id === id)?.name ?? "";

/** While leaving would cost the player something (`costs`: a question with its time running, a live game under way),
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

/** The top of a question: which one of how many, and its topic (and, in a duel with a friend, with whom: `versus`),
 * with the game's tally under it, if it has one. On a phone a game has the whole screen, the header with it, so the
 * way out is here: an arrow to Начало (on Начало itself too, where the day's ten are played: it opens afresh, the
 * day waiting there as a card), the way back (router.ts): back in the history where Начало is the page before. */
export function questionHead(n: number, total: number, aside: string, tally: Child = null, versus = ""): Child {
  return h(
    "header",
    { class: "question-head" },
    h(
      "a",
      { class: "game-leave", href: "/", "data-back": true, "aria-label": "Към Начало", title: "Към Начало" },
      h("span", { class: "i i-left", "aria-hidden": "true" }),
    ),
    h(
      "p",
      { class: "count" },
      h("b", { class: "count-n" }, String(n + 1)),
      h("span", { class: "count-of" }, h("span", { class: "num-word" }, " от "), String(total)),
    ),
    h(
      "div",
      { class: "head-side" },
      versus ? h("p", { class: "kicker versus" }, versus) : null,
      h("p", { class: "kicker" }, aside),
      tally,
    ),
  );
}

/** A run's tally while it's played: the right answers in a row it's on, and its points so far (rising from `from`),
 * once there are some. */
function tally(el: HTMLElement, points: number, from: number, inRow: number) {
  el.replaceChildren(
    ...[
      inRowChip(inRow),
      points > 0
        ? h(
            "span",
            { class: "tally-points", "aria-label": `${points} ${points === 1 ? "точка" : "точки"}` },
            countUp(points, from),
            h("small", null, points === 1 ? " точка" : " точки"),
          )
        : null,
    ].filter((c): c is HTMLElement => c !== null),
  );
}

/** How many right answers in a row a run's last ones are. */
function inRowOf(marks: Mark[]): number {
  let n = 0;
  for (let i = marks.length - 1; i >= 0 && marks[i]?.right; i--) n++;
  return n;
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

/** A question's seconds left, counting down with the clock: each second is worked out from when the time ends, so
 * that a busy page (a slow phone, a picture coming in) never leaves them behind it, as a tick every 1000 ms would.
 * `out` runs once, when the time is up; once `stopped`, they stop where they are. */
export interface Countdown {
  /** The whole seconds left (tracked). */
  (): number;
  /** The seconds left, untracked. */
  peek(): number;
  /** Sets the time left (ms) to the server's, when it says otherwise (a question shown again after a restart). */
  sync(ms: number): void;
}

export function countdown(ms: number, out?: () => void, stopped?: () => boolean): Countdown {
  let end = performance.now() + ms;
  const left = signal(Math.max(0, Math.ceil(ms / 1000)));
  let t = 0;
  let done = false;
  const next = (rest: number) => {
    t = window.setTimeout(step, rest > 0 ? rest % 1000 || 1000 : 0);
  };
  const step = () => {
    if (stopped?.()) return;
    const rest = end - performance.now();
    left.set(Math.max(0, Math.ceil(rest / 1000)));
    if (rest > 0) next(rest);
    else if (!done) {
      done = true;
      out?.();
    }
  };
  next(ms);
  onCleanup(() => clearTimeout(t));
  const c = (() => left()) as Countdown;
  c.peek = () => left.peek();
  c.sync = (rest: number) => {
    end = performance.now() + rest;
    clearTimeout(t);
    left.set(Math.max(0, Math.ceil(rest / 1000)));
    if (rest > 0) done = false; // the question shown again, with time: it can run out again
    if (!done) next(rest);
  };
  return c;
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
  taken: (now: State) => void,
): Child {
  const locked = signal(false);
  const stopped = signal(false); // the clock, once the answer is taken
  const problem = signal<Child>(null);
  const after = h("div", { class: "after", hidden: true });
  let progress = trail(s.trail, s.total, q.n);
  let sent = false;
  const score = h("div", { class: "tally" });
  tally(score, s.points, s.points, inRowOf(s.trail));

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

  // An answer goes once; after a failed send, only its retry goes again. The answers lock at the tap; the clock stops
  // once the answer is taken, as the server takes the time it came in: on a slow line, or none, it runs on in sight
  // while the answer is sent again quietly, and only then says what's wrong, under the question. What the player chose
  // stays chosen a moment, however quick the line, before the answer shows.
  const send = async (answer: Answer | null, retry = false) => {
    if (sent && !retry) return;
    sent = true;
    locked.set(true);
    problem.set(null);
    const held = answer === null ? 0 : performance.now() + holdMs;
    let res: Result;
    try {
      res = await tries(() => api<Result>("POST", `/api/runs/${s.id}/answer`, { n: q.n, answer }));
    } catch (err) {
      if ((err as ApiError).code === "out_of_step") return reload();
      problem.set(failure(err, () => send(answer, true), null));
      return;
    }
    stopped.set(true);
    taken(res.state);
    const wait = held - performance.now();
    if (wait > 0 && !calm.peek()) await new Promise((on) => at(wait, () => on(null)));
    reveal(res, answer);
  };

  // The answer shows in beats (DESIGN.md, Motion): the player's own answer judged, its sound and its pip; the right
  // one (if it wasn't theirs) and the verdict docked at the screen's foot, its points and the tally rising with them;
  // how everyone else answered; the fact, and the way on. With less motion, all at once.
  const reveal = (res: Result, answer: Answer | null) => {
    asked.reveal(res.reveal, answer, at);
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
      tally(score, res.state.points, s.points, res.inRow ?? 0);
      crowd = waiting(crowdLine(q.view.type, res.reveal.crowd, res.right));
      rest = [
        res.learned ? h("p", { class: "learned" }, "Нов факт в Алманаха") : null,
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
      // its points counting up from nothing).
      const told = verdict(kind, res.points, undefined, res.speed, res.row, res.inRow);
      if (told instanceof HTMLElement) told.removeAttribute("role");
      append(after, [told, crowd, ...rest]);
      after.hidden = false;
      page.classList.add("answered");
      room();
      say(
        spokenVerdict(kind, res.points, kind === "right" || kind === "exact" ? "" : spokenAnswer(q.view, res.reveal)),
      );
      advance = window.setTimeout(moveOn, lasts);
      // On a phone the panel docks at the screen's foot and the answers move up above it; where they can't all fit
      // (a picture, a short screen), the page moves just enough to show the right answer. On a big screen the answer
      // shows under the question, and the page moves to it.
      at(dockMs, () => {
        if (docked()) uncover(asked.node, after);
        else after.scrollIntoView({ block: "nearest", behavior: calm.peek() ? "auto" : "smooth" });
      });
    });
    at(beats.crowd, () => shows(crowd));
    at(beats.fact, () => {
      for (const part of rest) shows(part);
      // Where answering took the focus away with it (a pad, a list, a deck gone for their answer), it goes to the way
      // on; on an answer chosen, it stays there.
      const focus = document.activeElement;
      if (!focus || focus === document.body || !focus.isConnected || (focus as HTMLElement).offsetParent === null)
        after.querySelector<HTMLElement>(".up-next-go")?.focus({ preventScroll: true });
      due = res.state.done
        ? () => {
            // A run's result sounds its own end as it lands (results.ts); a duel's, here.
            if (versus) play("end");
            reload();
          }
        : next;
    });
  };

  const asked = ask(q.view, (a) => send(a), locked, say);

  // More of the question shows as its time runs (the next clue): the server sends it when it's due, not before.
  let more = 0;
  const lookAgain = (ms: number) => {
    more = window.setTimeout(async () => {
      if (sent) return;
      try {
        const now = await api<State>("GET", `/api/runs/${s.id}`);
        if (sent || now.question?.n !== q.n) return;
        asked.update?.(now.question.view);
        if (now.question.moreMs) lookAgain(now.question.moreMs);
      } catch {
        lookAgain(1000); // a bad moment on the line: once more, soon
      }
    }, ms);
  };
  if (q.moreMs) lookAgain(q.moreMs);
  onCleanup(() => clearTimeout(more));

  // The time: the seconds left, and when it's up, whatever has been put in (or nothing).
  const left = countdown(
    q.leftMs,
    () => send(asked.pending()),
    () => stopped.peek(),
  );

  // Leaving while the question's time runs would cost it, as the time runs on the server: a way out (the arrow, back,
  // a place in the header) asks first. Leaving gives the question up, so the run waits between two questions, where
  // the player comes back to it („Продължи“). Once the answer is in, leaving costs nothing and asks nothing.
  const leaveAsk = guardLeaving(
    "Ако излезеш сега, въпросът остава без отговор.",
    () => !locked(),
    async (on) => {
      if (!sent) {
        sent = true;
        locked.set(true);
        try {
          const res = await api<Result>("POST", `/api/runs/${s.id}/answer`, { n: q.n, answer: null });
          if (!res.state.done) keepGivenUp(s.id, q, res.reveal);
        } catch {
          // its time runs out on the server all the same
        }
      }
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

  // Each question takes the focus as it opens, so a screen reader reads it first (no ring for it: app.css, h1).
  const heading = h("h1", { class: "ask", tabindex: -1 }, q.view.text);
  requestAnimationFrame(() => {
    if (heading.isConnected) heading.focus({ preventScroll: true });
  });

  // On a phone the question is a column the screen's height: the head, the pips and the clock at the top, the
  // question under them, and what answers it at the foot, under the thumb (app.css).
  const page = h(
    "article",
    { class: "question run-question" },
    stays(
      questionHead(
        q.n,
        s.total,
        q.onThisDay ? `${topicName(q.category)} · На този ден` : topicName(q.category),
        score,
        versus,
      ),
      progress,
      timer(q.leftMs, q.limitMs, left, stopped),
    ),
    heading,
    picture(q.view, true),
    h("div", { class: "answering" }, asked.node, () => problem()),
    after,
    leaveAsk,
  );
  return page;
}

/** How long what the player chose stays chosen before the answer shows, however quick the line. */
const holdMs = 280;

/** How long the answer's panel takes to dock at a phone's foot (app.css), the answers moving up with it. */
const dockMs = 260;

/** Whether the answer docks at the screen's foot: a phone's width (app.css). */
const docked = () => matchMedia("(max-width: 47.99rem)").matches;

/** A part of the answer's panel, in its place but not shown yet; and shown. */
function waiting<T extends Child>(part: T): T {
  if (part instanceof HTMLElement) part.classList.add("unseen");
  return part;
}

function shows(part: Child): void {
  if (part instanceof HTMLElement) part.classList.remove("unseen");
}

/** Moves the page just enough that the answer (the right one, for a question of options) shows between the head and
 * the panel docked at the foot, when they can't all fit on the screen. */
function uncover(answers: Child, panel: HTMLElement): void {
  if (!(answers instanceof Element)) return;
  const key = answers.querySelector("button.option.right") ?? answers;
  const head = document.querySelector(".question-top")?.getBoundingClientRect().bottom ?? 0;
  const box = key.getBoundingClientRect();
  const by = Math.min(box.bottom - (panel.getBoundingClientRect().top - 12), box.top - head - 12);
  if (by > 0) scrollBy({ top: by, behavior: calm.peek() ? "auto" : "smooth" });
}

/** The top of a question (its count, topic and tally, and the pips), kept in view at the top of the screen while the
 * question and its answer scroll, and smaller there. The room it gives up stays as a margin, so nothing under it jumps.
 * It sits a pixel above the screen's edge when stuck, which is how it knows. */
function stays(...parts: Child[]): HTMLElement {
  const top = h("div", { class: "question-top" }, parts);
  const seen = new IntersectionObserver(
    ([e]) => {
      const stuck = !!e && e.intersectionRatio < 1 && e.boundingClientRect.top < 0;
      if (stuck === top.classList.contains("stuck")) return;
      if (!stuck) {
        top.classList.remove("stuck");
        top.style.marginBottom = "";
        return;
      }
      // Smaller, measured with its whole height still kept below it: the page is never shorter for a moment, which
      // on a page only a little taller than the screen could pull the scroll back up, out from under the finger.
      const tall = top.offsetHeight;
      top.style.marginBottom = `${tall}px`;
      top.classList.add("stuck");
      top.style.marginBottom = `${tall - top.offsetHeight}px`;
    },
    { threshold: 1 },
  );
  seen.observe(top);
  onCleanup(() => seen.disconnect());
  return top;
}

function kindOf(r: Result, given: Answer | null): VerdictKind {
  if (r.timedOut || given === null) return "time";
  if (r.exact) return "exact";
  if (r.right) return "right";
  return r.points > 0 ? "partial" : "wrong";
}

/** A verdict as a screen reader says it: „Не е това. Вярно е: Бийтълс.“, „Вярно! +1040 точки.“ */
function spokenVerdict(kind: VerdictKind, points: number, answer: string): string {
  const pts = points > 0 ? `+${formatNumber(points)} ${points === 1 ? "точка" : "точки"}.` : "";
  return [verdictWords[kind], pts, answer].filter(Boolean).join(" ");
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
