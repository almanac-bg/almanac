// Playing a run: a question, its answer and fact, the next, and so on to the end. The server keeps the clock and
// the score; this shows them.

import { type ApiError, api } from "../lib/api.ts";
import { append, type Child, h, listen, onCleanup, signal } from "../lib/dom.ts";
import { categories } from "../state.ts";
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
    h("button", { class: "btn", onclick: retry }, "Опитай пак"),
  );
}

/** A run left between questions (a refresh, coming back later): the next question waits for the player. */
function resume(s: State, next: () => void): Child {
  return h(
    "div",
    { class: "stack" },
    trail(s.trail, s.total),
    h("h1", null, `Въпрос ${s.at + 1} от ${s.total}`),
    h("p", { class: "muted" }, "Времето тръгва, щом го отвориш."),
    h("button", { class: "btn", onclick: next }, "Продължи"),
  );
}

/** A run's progress: a mark for each question, coloured by how it went. */
export function trail(marks: Mark[], total: number): HTMLElement {
  return h(
    "ol",
    { class: "trail", "aria-label": `${marks.length} от ${total} въпроса` },
    Array.from({ length: total }, (_, i) => {
      const m = marks[i];
      return h("li", { class: !m ? "" : m.right ? "right" : m.partial ? "partial" : "wrong" });
    }),
  );
}

const topicName = (id: string) => categories.find((c) => c.id === id)?.name ?? "";

function question(s: State, q: Shown, next: () => void, reload: () => void): Child {
  const locked = signal(false);
  const problem = signal<Child>(null);
  const after = h("div", { class: "after", hidden: true });
  const bar = h("div", { class: "time-bar" });
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
    clearTimeout(timer);
    clearInterval(tick);
    bar.classList.add("stopped");
    asked.reveal(res.reveal, answer);
    append(after, [
      verdict(res, answer),
      res.reveal.fact
        ? h("aside", { class: "fact" }, h("h2", null, "Знаеше ли?"), h("p", null, res.reveal.fact))
        : null,
      res.reveal.credit ? credit(res.reveal.credit) : null,
      report(res.reveal.id),
      h(
        "button",
        {
          class: "btn next",
          onclick: res.state.done ? reload : next,
          ref: (el) =>
            requestAnimationFrame(() => {
              el.focus({ preventScroll: true });
              el.scrollIntoView({ block: "nearest" });
            }),
        },
        res.state.done ? "Към резултата" : "Напред",
      ),
    ]);
    after.hidden = false;
  };

  const asked = ask(q.view, (a) => send(a), locked);

  // The time: a bar that runs out, the seconds beside it, and an empty answer when it's up.
  const timer = setTimeout(() => send(null), q.leftMs);
  const left = signal(Math.ceil(q.leftMs / 1000));
  const tick = setInterval(() => left.update((n) => Math.max(0, n - 1)), 1000);
  onCleanup(() => {
    clearTimeout(timer);
    clearInterval(tick);
  });
  bar.style.transform = `scaleX(${q.leftMs / q.limitMs})`;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      bar.style.transition = `transform ${q.leftMs}ms linear`;
      bar.style.transform = "scaleX(0)";
    }),
  );

  // Keys 1–4 answer a choice.
  listen(document, "keydown", (e: KeyboardEvent) => {
    if (q.view.type !== "choice" || e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
    const i = Number(e.key) - 1;
    if (i >= 0 && i < q.view.choices.length) send({ pick: i });
  });

  return h(
    "article",
    { class: "question" },
    h(
      "p",
      { class: "question-head muted" },
      h("span", null, `${q.n + 1} от ${s.total} · ${topicName(q.category)}`),
      h("span", { role: "timer", "aria-label": () => `${left()} секунди` }, () => (locked() ? "" : `${left()} с`)),
    ),
    bar,
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view),
    asked.node,
    () => problem(),
    after,
  );
}

function verdict(r: Result, given: Answer | null): Child {
  const [text, cls] =
    r.timedOut || given === null
      ? ["Времето изтече.", "wrong"]
      : r.exact
        ? ["Точно!", "right"]
        : r.right
          ? ["Вярно!", "right"]
          : r.points > 0
            ? ["Близо.", "partial"]
            : ["Не е това.", "wrong"];
  return h(
    "p",
    { class: `verdict ${cls}`, role: "status" },
    h("strong", null, text),
    r.points > 0 ? h("span", { class: "muted" }, ` +${r.points}`) : null,
  );
}

function credit(c: Credit): Child {
  return h(
    "p",
    { class: "credit muted" },
    "Снимка: ",
    h("a", { href: c.source, target: "_blank", rel: "noopener" }, c.credit),
    " · ",
    c.licenseUrl ? h("a", { href: c.licenseUrl, target: "_blank", rel: "noopener" }, c.license) : c.license,
  );
}
