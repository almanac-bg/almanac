// Playing a run: a question, its answer and fact, the next, and so on to the end. The server keeps the clock and
// the score; this shows them.

import { type ApiError, api } from "../lib/api.ts";
import { append, type Child, effect, h, listen, onCleanup, type Signal, signal } from "../lib/dom.ts";
import { play } from "../lib/sound.ts";
import { categories } from "../state.ts";
import { fact, type VerdictKind, verdict } from "../ui.ts";
import { ask, picture } from "./questions.ts";
import { report } from "./report.ts";
import type { Answer, Credit, Mark, Result, Shown, State } from "./types.ts";

/** Plays a run from where it stands; `done` draws what comes after its last answer. */
export function playRun(initial: State, done: (s: State) => Child): Child {
  const screen = signal<Child>(null);

  const next = async () => {
    try {
      at(await api<State>("POST", `/api/runs/${initial.id}/show`, {}), true);
    } catch (err) {
      screen.set(failed((err as ApiError).message, next));
    }
  };
  const reload = async () => {
    try {
      at(await api<State>("GET", `/api/runs/${initial.id}`), false);
    } catch (err) {
      screen.set(failed((err as ApiError).message, reload));
    }
  };
  // Where the run stands: its end, a question showing, or between questions (the next one waits for the player
  // unless they asked for it).
  const at = (s: State, asked: boolean) => {
    if (s.done) screen.set(done(s));
    else if (s.question) screen.set(question(s, s.question, next, reload));
    else if (asked || s.at === 0) next();
    else screen.set(resume(s, next));
  };

  at(initial, false);
  return h("div", { class: "run" }, () => screen());
}

function failed(message: string, retry: () => void): Child {
  return h(
    "div",
    { class: "stack" },
    h("p", { role: "alert" }, message),
    h("button", { class: "btn primary", onclick: retry }, "Опитай пак"),
  );
}

/** A run left between questions (a refresh, coming back later): the next question waits for the player. */
function resume(s: State, next: () => void): Child {
  return h(
    "div",
    { class: "stack" },
    h("h1", null, `Въпрос ${s.at + 1} от ${s.total}`),
    trail(s.trail, s.total, s.at),
    h("p", { class: "muted" }, "Времето тръгва, щом го отвориш."),
    h("button", { class: "btn primary big", onclick: next }, "Продължи"),
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

/** The top of a question: which one of how many, and its topic (and, in a duel, against whom). */
export function questionHead(n: number, total: number, aside: string): Child {
  return h(
    "header",
    { class: "question-head" },
    h(
      "p",
      { class: "count" },
      h("b", { class: "count-n" }, String(n + 1)),
      h("span", { class: "count-of" }, ` от ${total}`),
    ),
    h("p", { class: "kicker" }, aside),
  );
}

/** The time left: a bar that runs out with the seconds beside it, red for the last five, grey once answered. */
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
  // The last five seconds tick (while the question waits for an answer).
  effect(() => {
    const n = left();
    if (n > 0 && n <= 5 && !locked.peek()) play("tick");
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
      { class: "secs", role: "timer", "aria-label": () => `${left()} секунди` },
      () => String(left()),
      h("small", null, "с"),
    ),
    () => {
      if (locked()) freeze();
      return null;
    },
  );
}

function question(s: State, q: Shown, next: () => void, reload: () => void): Child {
  const locked = signal(false);
  const problem = signal<Child>(null);
  const after = h("div", { class: "after", hidden: true });
  let progress = trail(s.trail, s.total, q.n);
  let sent = false;

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
    const kind = kindOf(res, answer);
    play(kind);
    append(after, [
      verdict(kind, res.points),
      res.reveal.fact ? fact(res.reveal.fact) : null,
      res.reveal.credit ? credit(res.reveal.credit) : null,
      h(
        "button",
        {
          class: "btn primary big next",
          onclick: res.state.done
            ? () => {
                play("end");
                reload();
              }
            : next,
          ref: (el) =>
            requestAnimationFrame(() => {
              el.focus({ preventScroll: true });
              el.scrollIntoView({ block: "nearest" });
            }),
        },
        res.state.done ? "Към резултата" : "Напред",
      ),
      report(res.reveal.id),
    ]);
    after.hidden = false;
  };

  const asked = ask(q.view, (a) => send(a), locked);

  // The time: the seconds left, and an empty answer when it's up.
  const timeout = setTimeout(() => send(null), q.leftMs);
  const left = signal(Math.ceil(q.leftMs / 1000));
  const tick = setInterval(() => left.update((n) => Math.max(0, n - 1)), 1000);
  onCleanup(() => {
    clearTimeout(timeout);
    clearInterval(tick);
  });

  // Keys 1–4 answer a choice.
  listen(document, "keydown", (e: KeyboardEvent) => {
    if (q.view.type !== "choice" || e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
    const i = Number(e.key) - 1;
    if (i >= 0 && i < q.view.choices.length) send({ pick: i });
  });

  return h(
    "article",
    { class: "question" },
    questionHead(q.n, s.total, topicName(q.category)),
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
