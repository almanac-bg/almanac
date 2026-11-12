// A room: the lobby, then each question for everyone at once, its answer with the scores, and the final standings.
// The server sends the room as this player sees it after every change; the browser reconnects if the line drops.

import { answered, ask, picture } from "../game/questions.ts";
import { report } from "../game/report.ts";
import { shareButton } from "../game/results.ts";
import type { Answer, Reveal, View } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, computed, h, onCleanup, signal, untracked } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { categories, player } from "../state.ts";

interface RoomView {
  code: string;
  phase: "lobby" | "question" | "reveal" | "end";
  host: string;
  isHost: boolean;
  canLead: boolean;
  category: string;
  n: number;
  total: number;
  players: {
    name: string;
    points: number;
    rights: number;
    online: boolean;
    answered: boolean;
    me?: boolean;
    gained?: number;
    right?: boolean;
  }[];
  question?: {
    category: string;
    view: View;
    limitMs: number;
    leftMs: number;
    given?: Answer;
    reveal?: { answer: Reveal; points: number; right: boolean; exact?: boolean; missed?: boolean };
  };
}

const topicName = (id: string) => categories.find((c) => c.id === id)?.name ?? "Всички теми";
const spaced = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

export function room([code = ""]: string[]) {
  title(`Стая ${spaced(code)}`);
  const view = signal<RoomView | null>(null);
  const trouble = signal<"" | "reconnecting" | "gone" | "full">("");

  let es: EventSource | null = null;
  player()
    .then(() => {
      es = new EventSource(`/api/rooms/${code}/events`);
      es.onmessage = (e) => {
        trouble.set("");
        view.set(JSON.parse(e.data));
      };
      // The room is gone (closed, or the server restarted), or full: no reconnecting to it.
      es.addEventListener("closed", () => {
        es?.close();
        trouble.set("gone");
      });
      es.addEventListener("full", () => {
        es?.close();
        trouble.set("full");
      });
      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED) trouble.set("gone");
        else trouble.set("reconnecting"); // the browser tries again by itself
      };
    })
    .catch(() => trouble.set("gone"));
  onCleanup(() => es?.close());

  // Each phase (and each question) is drawn once; what changes inside it follows the view.
  const key = computed(() => {
    const v = view();
    return v ? `${v.phase}:${v.n}` : "";
  });
  return h(
    "div",
    { class: "screen" },
    () =>
      trouble() === "full"
        ? h("div", { class: "stack" }, h("h1", null, "Стаята е пълна"), h("p", null, "В една стая играят до 50 души."))
        : null,
    () =>
      trouble() === "gone"
        ? h(
            "div",
            { class: "stack" },
            h("h1", null, "Няма такава стая"),
            h("p", null, "Може кодът да е грешен или стаята да е затворена."),
            h("a", { href: "/together" }, "Отвори нова стая"),
          )
        : null,
    () =>
      trouble() === "reconnecting"
        ? h("p", { class: "muted", role: "status" }, "Връзката прекъсна. Свързваме се отново…")
        : null,
    () => {
      const k = key();
      if (trouble() === "gone" || trouble() === "full") return null;
      if (!k) return h("p", { class: "muted" }, "…");
      const v = untracked(view) as RoomView;
      switch (v.phase) {
        case "lobby":
          return lobby(view as () => RoomView, code);
        case "question":
          return question(view as () => RoomView, code, v);
        case "reveal":
          return reveal(view as () => RoomView, code, v);
        case "end":
          return end(view as () => RoomView, code);
      }
    },
  );
}

async function lead(code: string, action: "start" | "next", error: (s: string) => void) {
  try {
    await api("POST", `/api/rooms/${code}/${action}`);
  } catch (err) {
    error((err as ApiError).message);
  }
}

function waiting(view: () => RoomView, what: string): Child {
  return () => {
    const v = view();
    return v.canLead ? null : h("p", { class: "muted" }, `Чакаме ${v.host} да ${what}.`);
  };
}

function lobby(view: () => RoomView, code: string): Child {
  const error = signal("");
  return h(
    "div",
    { class: "stack" },
    h("h1", null, `Стая ${spaced(code)}`),
    h("p", null, () => `${topicName(view().category)}. Дай кода на другите или им прати линка.`),
    shareButton("Прати линка", () => "Ела да играем на АЛМАНАХ:", `${location.origin}/r/${code}`),
    h("h2", null, () => `Играчи (${view().players.length})`),
    h("ul", { class: "players" }, () =>
      view().players.map((p) =>
        h("li", { class: p.online ? "" : "muted" }, p.name, p.me ? " (ти)" : "", p.online ? "" : " — извън стаята"),
      ),
    ),
    () =>
      view().canLead ? h("button", { class: "btn", onclick: () => lead(code, "start", error.set) }, "Започни") : null,
    waiting(view, "започне"),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

function head(v: RoomView, left?: () => string): Child {
  const q = v.question;
  return h(
    "p",
    { class: "question-head muted" },
    h("span", null, `${v.n + 1} от ${v.total} · ${topicName(q?.category ?? "")}`),
    left ? h("span", { role: "timer" }, left) : null,
  );
}

function question(view: () => RoomView, code: string, first: RoomView): Child {
  const q = first.question;
  if (!q) return null;
  const locked = signal(!!q.given);
  const sent = signal(!!q.given);
  const left = signal(Math.ceil(q.leftMs / 1000));
  const tick = setInterval(() => {
    left.update((n) => Math.max(0, n - 1));
    if (left.peek() === 0) locked.set(true);
  }, 1000);
  onCleanup(() => clearInterval(tick));
  const bar = h("div", { class: "time-bar" });
  bar.style.transform = `scaleX(${q.leftMs / q.limitMs})`;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      bar.style.transition = `transform ${q.leftMs}ms linear`;
      bar.style.transform = "scaleX(0)";
    }),
  );
  const error = signal("");
  const asked = ask(
    q.view,
    async (a) => {
      locked.set(true);
      try {
        await api("POST", `/api/rooms/${code}/answer`, { n: first.n, answer: a });
        sent.set(true);
      } catch (err) {
        error.set((err as ApiError).message);
      }
    },
    locked,
  );
  return h(
    "article",
    { class: "question" },
    head(first, () => `${left()} с`),
    bar,
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view),
    asked.node,
    () => {
      const v = view();
      const done = v.players.filter((p) => p.answered).length;
      return h(
        "p",
        { class: "muted", role: "status" },
        sent() ? "Отговорът ти е приет. " : "",
        `Отговориха ${done} от ${v.players.filter((p) => p.online || p.answered).length}.`,
      );
    },
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

function reveal(view: () => RoomView, code: string, first: RoomView): Child {
  const q = first.question;
  const r = q?.reveal;
  if (!q || !r) return null;
  const error = signal("");
  const last = first.n + 1 >= first.total;
  const [text, cls] = r.missed
    ? ["Без отговор.", "wrong"]
    : r.exact
      ? ["Точно!", "right"]
      : r.right
        ? ["Вярно!", "right"]
        : r.points > 0
          ? ["Близо.", "partial"]
          : ["Не е това.", "wrong"];
  return h(
    "article",
    { class: "question" },
    head(first),
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view),
    answered(q.view, r.answer, q.given ?? null),
    h(
      "p",
      { class: `verdict ${cls}`, role: "status" },
      h("strong", null, text),
      r.points > 0 ? h("span", { class: "muted" }, ` +${r.points}`) : null,
    ),
    r.answer.fact ? h("p", { class: "fact" }, h("strong", null, "Знаеше ли? "), r.answer.fact) : null,
    report(r.answer.id),
    standings(view, true),
    () =>
      view().canLead
        ? h(
            "button",
            { class: "btn", onclick: () => lead(code, "next", error.set) },
            last ? "Към класирането" : "Напред",
          )
        : null,
    waiting(view, last ? "покаже класирането" : "продължи"),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

function standings(view: () => RoomView, gains: boolean): Child {
  return h("section", { class: "board" }, () =>
    h(
      "ol",
      null,
      view().players.map((p, i) =>
        h(
          "li",
          { class: p.me ? "row me" : "row" },
          h("span", { class: "place" }, String(i + 1)),
          h("span", { class: "who" }, p.name),
          h("span", { class: "pts" }, gains && p.gained ? `+${p.gained} · ${p.points}` : String(p.points)),
        ),
      ),
    ),
  );
}

function end(view: () => RoomView, code: string): Child {
  const error = signal("");
  return h(
    "div",
    { class: "stack" },
    h("h1", null, () => {
      const [best] = view().players;
      return best ? `${best.name} печели` : "Край";
    }),
    h("p", { class: "muted" }, () => `Стая ${spaced(code)} · ${topicName(view().category)}`),
    standings(view, false),
    () =>
      view().canLead ? h("button", { class: "btn", onclick: () => lead(code, "start", error.set) }, "Нова игра") : null,
    waiting(view, "започне нова игра"),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}
