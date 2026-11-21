// Answering a question, the same in every game (run.ts). The question's widget is questions.ts's; this is what's
// around it:
//
// - The question takes the focus as it opens, so that a screen reader reads it first, and what's said as it goes (a
//   clue come out, an answer's verdict) is said in one live region (liveRegion), there from the run's start.
// - The options lock at the tap, and an answer goes once: never a second while one is on its way or in.
// - An answer that doesn't get through (no line, the server for a moment) is sent again, the same, a few times and then
//   said, with „Опитай пак“. The server takes an answer sent again, its reply lost, as the first.
// - It's in once the server says so, by its reply. The clock stops then: the server took the time it came in.
// - Refused (a „no“ of the server's, not that it's too late): said, and the options are free again while the question
//   has time. Too late: said, and that's that.
// - The time is the server's: the clock follows it as the server's view says otherwise (a question shown again after
//   a restart), and what's been put in when it runs out is the answer.

import { ApiError, errorText, passing, tries } from "../lib/api.ts";
import { effect, h, lifetime, onCleanup, type Signal, signal, untracked } from "../lib/dom.ts";
import { type VerdictKind, verdictSays } from "../ui.ts";
import { type Asked, ask, spokenAnswer, wholeWords } from "./questions.ts";
import type { Answer, Reveal, View } from "./types.ts";

/** Says something to a screen reader, in a game's live region. */
export type Say = (text: string) => void;

/** One live region for a whole game, there from its start and empty until it speaks: screen readers reliably read
 * only such a one. `say` puts a line in it (the same line again is said again). */
export function liveRegion(): { node: HTMLElement; say: Say } {
  const node = h("p", { class: "sr", role: "status" });
  let speaking = 0;
  onCleanup(() => clearTimeout(speaking));
  return {
    node,
    say(text) {
      node.textContent = "";
      clearTimeout(speaking);
      speaking = window.setTimeout(() => {
        node.textContent = text;
      }, 60);
    },
  };
}

/** A verdict as a screen reader says it, in the game's live region: „Не е това. Верният отговор е Бийтълс.“,
 * „Вярно!“ */
export function spokenVerdict(kind: VerdictKind, view: View, reveal: Reveal): string {
  const answer = kind === "right" || kind === "exact" ? "" : spokenAnswer(view, reveal);
  return [verdictSays(kind, view.type), answer].filter(Boolean).join(" ");
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
  /** The ms left by this screen's clock, untracked: below zero once the time is up. */
  ms(): number;
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
  c.ms = () => end - performance.now();
  c.sync = (rest: number) => {
    end = performance.now() + rest;
    clearTimeout(t);
    left.set(Math.max(0, Math.ceil(rest / 1000)));
    if (rest > 0) done = false; // the question shown again, with time: it can run out again
    if (!done) next(rest);
  };
  return c;
}

/** Where a question's answer is: none yet (or refused: free again), on its way, in, or not to be (too late; a run's,
 * given up on after its tries, until „Опитай пак“). */
type Step = "" | "sending" | "taken" | "closed";

/** What went wrong with the answer: the error, and the way to send it again where that can help (a run's „Опитай
 * пак“; null otherwise). */
export interface Problem {
  err: ApiError;
  retry: (() => void) | null;
}

export interface AnswerSpec<R> {
  /** The question as it opens, and its time left. */
  view: View;
  leftMs: number;
  /** Sends the answer once (null: none, the time up or the question given up); resolves with the server's reply. */
  post: (answer: Answer | null) => Promise<R>;
  /** Whether the question still takes an answer, as far as this screen knows. An answer that doesn't get through is
   * sent again only while it does. */
  open: () => boolean;
  /** How many times an answer is tried before what's wrong is said, with „Опитай пак“; none: again and again while
   * the question is open. */
  tries?: number;
  /** When the time runs out with nothing put in, that's sent as no answer (its answer shows at once); else the options
   * just lock. */
  sendNone?: boolean;
  /** The answer is in, by the server's reply: what it said, and the answer. */
  taken?: (reply: R, answer: Answer | null) => void;
  /** An error the screen deals with itself (a run out of step: it loads again); true if it did. */
  handles?: (err: ApiError) => boolean;
  /** The question takes the focus as it opens (a run's). */
  focus?: boolean;
  /** The game's live region (a clue come out is said there). */
  say?: Say;
}

export interface Answering<R> {
  /** The question, as a heading (it takes the focus as the question opens, if `focus`). */
  heading: HTMLElement;
  /** The answering part (options, a pad …), under the question. */
  asked: Asked;
  /** No answer can be given now: one is on its way or in, or the time is up. */
  locked: Signal<boolean>;
  /** The answer is in (by the server's reply). */
  taken: () => boolean;
  /** The clock stopped: the answer is in. */
  stopped: Signal<boolean>;
  /** The seconds left. */
  left: Countdown;
  /** What went wrong with the answer, while it's not in (null: nothing). */
  problem: () => Problem | null;
  /** Sends an answer as a tap does (and as leaving gives the question up: null), unless one is on its way or in.
   * Resolves with the reply if this send is the one taken. */
  send(answer: Answer | null): Promise<R | undefined>;
}

/** Asks a question and sees its answer through (above). */
export function answering<R>(spec: AnswerSpec<R>): Answering<R> {
  const st = { step: signal<Step>(""), problem: signal<Problem | null>(null) };
  const life = lifetime();
  const taken = () => st.step() === "taken";

  const send = (answer: Answer | null): Promise<R | undefined> => {
    if (st.step.peek() !== "") return Promise.resolve(undefined);
    return go(answer);
  };
  const go = async (answer: Answer | null): Promise<R | undefined> => {
    st.step.set("sending");
    st.problem.set(null);
    try {
      const reply = await tries(() => spec.post(answer), {
        // Not again once the question has moved on.
        open: () => untracked(spec.open),
        pause: spec.tries ? 800 : 500,
        max: spec.tries ?? Number.POSITIVE_INFINITY,
      });
      st.step.set("taken");
      if (!life.aborted) spec.taken?.(reply, answer);
      return reply;
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("server", errorText(e));
      if (!life.aborted && spec.handles?.(err)) return undefined;
      const late = err.code === "not_now" || !untracked(spec.open);
      const retry = !late && passing(err) ? () => void go(answer) : null;
      st.problem.set({ err, retry });
      // Refused, not late: the options are free again (while there's time). Late, or given up on: not.
      st.step.set(late || retry ? "closed" : "");
      return undefined;
    }
  };

  const locked = signal(true);
  const asked = ask(spec.view, (a) => void send(a), locked, spec.say);
  // When the time is up, whatever has been put in (a typed number, things moved into order) is the answer.
  const left = countdown(
    spec.leftMs,
    () => {
      const pending = asked.pending();
      if (pending || spec.sendNone) void send(pending);
    },
    () => untracked(taken),
  );

  const stopped = signal(false);
  effect(() => locked.set(st.step() !== "" || taken() || left() <= 0 || !spec.open()));
  effect(() => stopped.set(taken()));
  // Free again after a refusal: what was picked isn't any more.
  let was = locked.peek();
  effect(() => {
    const now = locked();
    if (was && !now && asked.node instanceof Element)
      for (const b of asked.node.querySelectorAll(".picked")) b.classList.remove("picked");
    was = now;
  });

  const heading = h("h1", { class: "ask", tabindex: -1 }, wholeWords(spec.view.text));
  if (spec.focus)
    requestAnimationFrame(() => {
      if (heading.isConnected) heading.focus({ preventScroll: true });
    });

  const problem = () => (taken() ? null : st.problem());
  return {
    heading,
    asked,
    locked,
    taken,
    stopped,
    left,
    problem,
    send,
  };
}
