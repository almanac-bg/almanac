// Playing a run: a question, its answer, and on by itself to the next, to the end. The server keeps the clock and
// the score; this shows them. What's behind each answer („Знаеше ли?“) and a word about a question wait for the
// end, so that the game flows.

import { type ApiError, api } from "../lib/api.ts";
import { append, type Child, effect, h, listen, onCleanup, type Signal, signal } from "../lib/dom.ts";
import { tickOn } from "../lib/prefs.ts";
import { play, playAnswer, playCount } from "../lib/sound.ts";
import { categories, playing } from "../state.ts";
import { countUp, inRowChip, type VerdictKind, verdict } from "../ui.ts";
import { ask, picture } from "./questions.ts";
import type { Answer, Credit, Mark, Result, Shown, State, View } from "./types.ts";

/** Plays a run from where it stands; `done` draws what comes after its last answer. */
export function playRun(initial: State, done: (s: State) => Child): Child {
  const screen = signal<Child>(null);

  const next = async () => {
    try {
      at(await api<State>("POST", `/api/runs/${initial.id}/show`, {}));
    } catch (err) {
      screen.set(failed((err as ApiError).message, next));
    }
  };
  const reload = async () => {
    try {
      at(await api<State>("GET", `/api/runs/${initial.id}`));
    } catch (err) {
      screen.set(failed((err as ApiError).message, reload));
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
  onCleanup(() => {
    if (seen) document.removeEventListener("visibilitychange", seen);
    playing.set(false);
  });

  // Where the run stands: its end, a question showing, or between questions (the next one opens at once).
  const at = (s: State) => {
    playing.set(!s.done);
    if (s.done) screen.set(done(s));
    else if (s.question) screen.set(question(s, s.question, next, reload));
    else whenSeen(next);
  };

  at(initial);
  return h("div", { class: "run" }, () => screen());
}

/** Before a run: three seconds to settle in, a ring running out around them, with a way back out (also Esc) and
 * a way to start at once. Each second beeps; the start an octave higher. */
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
  onCleanup(() => clearInterval(tick));
  playCount(seconds);
  listen(document, "keydown", (e) => {
    if (e.key === "Escape") leave(cancel);
  });

  // The ring: a full circle that runs down with the clock (in CSS, over the same seconds), like a question's time bar.
  const ring = svg("svg", { class: "ready-ring", viewBox: "0 0 120 120", "aria-hidden": "true" });
  const circle = (cls: string) => svg("circle", { class: cls, cx: 60, cy: 60, r: 52, pathLength: 100 });
  ring.append(circle("ready-track"), circle("ready-arc"));
  ring.style.setProperty("--ready", `${seconds}s`);

  return h(
    "div",
    { class: "screen get-ready" },
    h("p", { class: "kicker" }, what),
    h("h1", null, "Приготви се"),
    h(
      "div",
      { class: "ready-clock", role: "timer", "aria-label": () => `Започва след ${left()} с` },
      ring,
      h("b", { class: "ready-n" }, () => String(Math.max(1, left()))),
    ),
    h(
      "div",
      { class: "actions" },
      h("button", { class: "btn primary big", onclick: begin }, "Започни сега"),
      h("button", { class: "btn", onclick: () => leave(cancel) }, "Откажи"),
    ),
  );
}

function svg(name: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function failed(message: string, retry: () => void): Child {
  return h(
    "div",
    { class: "stack" },
    h("p", { role: "alert" }, message),
    h("button", { class: "btn primary", onclick: retry }, "Опитай пак"),
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

/** The top of a question: which one of how many, and its topic (and, in a duel, against whom), with the game's
 * tally under it, if it has one. */
export function questionHead(n: number, total: number, aside: string, tally: Child = null): Child {
  return h(
    "header",
    { class: "question-head" },
    h(
      "p",
      { class: "count" },
      h("b", { class: "count-n" }, String(n + 1)),
      h("span", { class: "count-of" }, ` от ${total}`),
    ),
    h("div", { class: "head-side" }, h("p", { class: "kicker" }, aside), tally),
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
            h("small", null, " т."),
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

/** The time left: a bar that runs out with the seconds beside it, red for the last five, grey once answered. The
 * clock ticks each second, and beeps for each of the last five. */
export function timer(leftMs: number, limitMs: number, left: () => number, locked: Signal<boolean>): Child {
  const bar = h("div", { class: "time-bar" });
  bar.style.transform = `scaleX(${leftMs / limitMs})`;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (locked.peek()) return;
      bar.style.transition = `transform ${leftMs}ms linear`;
      bar.style.transform = "scaleX(0)";
    }),
  );
  effect(() => {
    const n = left();
    if (n <= 0 || locked.peek() || !tickOn.peek()) return;
    play(n <= 5 ? "hurry" : n % 2 ? "tick" : "tock");
  });
  // Once answered, the bar stops where it is.
  const freeze = () => {
    const now = getComputedStyle(bar).transform;
    bar.style.transition = "none";
    bar.style.transform = now === "none" ? bar.style.transform : now;
  };
  return h(
    "div",
    { class: () => (locked() ? "timer stopped" : left() <= 5 ? "timer low" : "timer") },
    h("div", { class: "track" }, bar),
    h(
      "span",
      { class: "secs", role: "timer", "aria-label": () => `${left()} ${left() === 1 ? "секунда" : "секунди"}` },
      () => String(left()),
      h("small", null, "с"),
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

/** The game moving on by itself: a line that fills while the answer shows. */
export function upNext(ms: number, label: string): Child {
  const fill = h("i", { class: "up-next-fill" });
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      fill.style.transition = `transform ${ms}ms linear`;
      fill.style.transform = "scaleX(1)";
    }),
  );
  return h("div", { class: "up-next", role: "status" }, h("span", null, label), h("span", { class: "track" }, fill));
}

function question(s: State, q: Shown, next: () => void, reload: () => void): Child {
  const locked = signal(false);
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
  const moveOn = () => {
    if (!due || document.hidden) return;
    const go = due;
    due = null;
    go();
  };
  document.addEventListener("visibilitychange", moveOn);
  onCleanup(() => {
    clearTimeout(advance);
    document.removeEventListener("visibilitychange", moveOn);
  });

  // An answer goes once; after a failed send, only its retry goes again.
  const send = async (answer: Answer | null, retry = false) => {
    if (sent && !retry) return;
    sent = true;
    locked.set(true);
    problem.set(null);
    let res: Result;
    try {
      res = await api<Result>("POST", `/api/runs/${s.id}/answer`, { n: q.n, answer });
    } catch (err) {
      const e = err as ApiError;
      if (e.code === "out_of_step") return reload();
      problem.set(failed(e.message, () => send(answer, true)));
      return;
    }
    clearTimeout(timeout);
    clearInterval(tick);
    asked.reveal(res.reveal, answer);
    const now = trail(res.state.trail, s.total);
    progress.replaceWith(now);
    progress = now;
    tally(score, res.state.points, s.points, res.inRow ?? 0);
    const kind = kindOf(res, answer);
    playAnswer(kind, res.inRow ?? 0);
    const pause = pauseFor(q.view);
    append(after, [
      verdict(kind, res.points, undefined, res.speed, res.row, res.inRow),
      res.learned ? h("p", { class: "learned" }, "Нов факт в Алманаха") : null,
      res.reveal.credit ? credit(res.reveal.credit) : null,
      upNext(pause, res.state.done ? "Към резултата…" : `Въпрос ${q.n + 2} след малко…`),
    ]);
    after.hidden = false;
    requestAnimationFrame(() => after.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    due = res.state.done
      ? () => {
          play("end");
          reload();
        }
      : next;
    advance = window.setTimeout(moveOn, pause);
  };

  const asked = ask(q.view, (a) => send(a), locked);

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
  const timeout = setTimeout(() => send(asked.pending()), q.leftMs);
  const left = signal(Math.ceil(q.leftMs / 1000));
  const tick = setInterval(() => left.update((n) => Math.max(0, n - 1)), 1000);
  onCleanup(() => {
    clearTimeout(timeout);
    clearInterval(tick);
  });

  // Keys 1–4 answer a choice (or clues).
  listen(document, "keydown", (e: KeyboardEvent) => {
    if (
      (q.view.type !== "choice" && q.view.type !== "clues") ||
      e.target instanceof HTMLInputElement ||
      e.metaKey ||
      e.ctrlKey
    )
      return;
    const i = Number(e.key) - 1;
    if (i >= 0 && i < (q.view.type === "choice" ? (q.view.choices ?? q.view.pictures ?? []) : q.view.choices).length)
      send({ pick: i });
  });

  return h(
    "article",
    { class: "question" },
    questionHead(q.n, s.total, topicName(q.category), score),
    progress,
    timer(q.leftMs, q.limitMs, left, locked),
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view),
    asked.node,
    () => problem(),
    after,
  );
}

function kindOf(r: Result, given: Answer | null): VerdictKind {
  if (r.timedOut || given === null) return "time";
  if (r.exact) return "exact";
  if (r.right) return "right";
  return r.points > 0 ? "partial" : "wrong";
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
