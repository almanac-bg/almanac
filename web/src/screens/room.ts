// A room: the lobby, then each question for everyone at once, its answer with the scores, and the final standings.
// The server sends the room as this player sees it after every change; the browser reconnects if the line drops.

import { findDuel } from "../game/duel.ts";
import { answered, ask, picture } from "../game/questions.ts";
import { report } from "../game/report.ts";
import { boardRow, shareButton } from "../game/results.ts";
import { questionHead, timer } from "../game/run.ts";
import type { Answer, Reveal, View } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, computed, h, onCleanup, signal, untracked } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { categories, player } from "../state.ts";
import { fact, type VerdictKind, verdict } from "../ui.ts";

interface RoomView {
  code: string;
  duel?: boolean;
  /** A duel between friends: one asked the other to it. */
  invite?: boolean;
  phase: "lobby" | "question" | "reveal" | "end";
  host: string;
  isHost: boolean;
  canLead: boolean;
  category: string;
  n: number;
  total: number;
  players: Player[];
  question?: {
    category: string;
    view: View;
    limitMs: number;
    leftMs: number;
    given?: Answer;
    reveal?: { answer: Reveal; points: number; right: boolean; exact?: boolean; missed?: boolean };
  };
}

interface Player {
  name: string;
  points: number;
  rights: number;
  online: boolean;
  answered: boolean;
  me?: boolean;
  recording?: boolean;
  gained?: number;
  right?: boolean;
}

const topicName = (id: string) => categories.find((c) => c.id === id)?.name ?? "Всички теми";
const nameOf = (p: Player) => (p.recording ? `${p.name} (запис)` : p.name);
/** In a duel: the other one. */
const opponent = (v: RoomView) => v.players.find((p) => !p.me);
const spaced = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

export function room([code = ""]: string[]) {
  title("Заедно");
  const view = signal<RoomView | null>(null);
  const trouble = signal<"" | "reconnecting" | "gone" | "full" | "declined" | "expired">("");
  // Where each player stood at the last answer: how far they've moved since is the room's rank change.
  const places = new Map<string, number>();

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
      // A duel between friends that won't happen: turned down, or not answered in time.
      for (const why of ["declined", "expired"] as const) {
        es.addEventListener(why, () => {
          es?.close();
          trouble.set(why);
        });
      }
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
        ? h(
            "div",
            { class: "stack" },
            h("h1", null, "Стаята е пълна"),
            h("p", { class: "lead" }, "В една стая играят до 50 души."),
          )
        : null,
    () =>
      trouble() === "gone"
        ? h(
            "div",
            { class: "stack" },
            h("h1", null, "Няма такава стая"),
            h("p", { class: "lead" }, "Може кодът да е грешен или стаята да е затворена."),
            h("a", { class: "btn primary", href: "/together" }, "Отвори нова стая"),
          )
        : null,
    () => {
      const why = trouble();
      return why === "declined" || why === "expired" ? notToBe(view.peek(), why) : null;
    },
    () =>
      trouble() === "reconnecting"
        ? h("p", { class: "status", role: "status" }, "Връзката прекъсна. Свързваме се отново…")
        : null,
    () => {
      const k = key();
      if (trouble() !== "" && trouble() !== "reconnecting") return null;
      if (!k) return h("p", { class: "muted" }, "…");
      const v = untracked(view) as RoomView;
      switch (v.phase) {
        case "lobby":
          places.clear();
          return lobby(view as () => RoomView, code);
        case "question":
          return question(view as () => RoomView, code, v);
        case "reveal":
          return reveal(view as () => RoomView, code, v, places);
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
    if (v.duel) return v.phase === "reveal" ? h("p", { class: "status" }, "Следващият въпрос идва след малко.") : null;
    return v.canLead ? null : h("p", { class: "status" }, `Чакаме ${v.host} да ${what}.`);
  };
}

/** A duel between friends that won't happen, said to whoever is still looking at it. */
function notToBe(v: RoomView | null, why: "declined" | "expired"): Child {
  const asked = v?.players[0]?.me; // the one who asked is the first in the duel
  const them = v ? opponent(v)?.name : undefined;
  const [heading, text] = !asked
    ? ["Дуелът е отменен", "Може би друг път."]
    : why === "declined"
      ? ["Не може сега", `${them ?? "Приятелят ти"} отказа дуела. Покани отново по-късно.`]
      : ["Поканата изтече", `${them ?? "Приятелят ти"} не дойде за 10 минути. Покани отново по-късно.`];
  return h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Дуел"),
      h("h1", null, heading),
      h("p", { class: "lead" }, text),
    ),
    h("a", { class: "btn primary big", href: "/together" }, "Към Заедно"),
  );
}

/** Waiting for a friend asked to a duel: who, how long it stays open, and a way to call it off. */
function invited(view: () => RoomView, code: string): Child {
  const error = signal("");
  const them = () => opponent(view())?.name ?? "";
  return h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Дуел с приятел"),
      h("h1", null, () => `Дуел с ${them()}`),
      h("p", { class: "lead" }, "Чакаме да дойде. Поканата важи 10 минути. Щом влезе, започвате."),
    ),
    h("p", { class: "status", role: "status" }, () =>
      opponent(view())?.online ? `${them()} е тук.` : `${them()} още не е в дуела.`,
    ),
    h(
      "button",
      {
        class: "link",
        type: "button",
        onclick: async () => {
          try {
            await api("POST", `/api/rooms/${code}/decline`, {});
            go("/together");
          } catch (err) {
            error.set((err as ApiError).message);
          }
        },
      },
      "Откажи",
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

function lobby(view: () => RoomView, code: string): Child {
  const error = signal("");
  if (view().duel && view().invite) return invited(view, code);
  if (view().duel)
    return h("div", { class: "stack" }, h("p", { class: "kicker" }, "Дуел"), h("h1", null, "Чакаме съперника…"));
  return h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, () => topicName(view().category)),
      h("h1", null, "Стая ", h("span", { class: "code-big" }, spaced(code))),
      h("p", { class: "lead" }, "Дай кода на другите или им прати линка."),
    ),
    shareButton("Прати линка", () => "Ела да играем на АЛМАНАХ:", `${location.origin}/r/${code}`, false),
    h(
      "section",
      { class: "card" },
      h("h2", { class: "section-title" }, () => `Играчи (${view().players.length})`),
      h("ul", { class: "players" }, () =>
        view().players.map((p) =>
          h(
            "li",
            { class: [!p.online && "away", p.me && "me"].filter(Boolean).join(" ") || undefined },
            p.name,
            p.me ? " (ти)" : "",
            p.online ? "" : " — извън стаята",
          ),
        ),
      ),
    ),
    () =>
      view().canLead
        ? h("button", { class: "btn primary big", onclick: () => lead(code, "start", error.set) }, "Започни")
        : null,
    waiting(view, "започне"),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

/** Which question, its topic, and in a duel, against whom. */
function head(v: RoomView): Child {
  const against = v.duel ? opponent(v) : undefined;
  const topic = topicName(v.question?.category ?? "");
  return questionHead(v.n, v.total, against ? `${topic} · срещу ${nameOf(against)}` : topic);
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
    head(first),
    timer(q.leftMs, q.limitMs, left, locked),
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view),
    asked.node,
    () => {
      const v = view();
      const done = v.players.filter((p) => p.answered).length;
      return h(
        "p",
        { class: "status", role: "status" },
        sent() ? "Отговорът ти е приет. " : "",
        `Отговориха ${done} от ${v.players.filter((p) => p.online || p.answered).length}.`,
      );
    },
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

function reveal(view: () => RoomView, code: string, first: RoomView, places: Map<string, number>): Child {
  const q = first.question;
  const r = q?.reveal;
  if (!q || !r) return null;
  const error = signal("");
  const last = first.n + 1 >= first.total;
  const kind: VerdictKind = r.missed
    ? "time"
    : r.exact
      ? "exact"
      : r.right
        ? "right"
        : r.points > 0
          ? "partial"
          : "wrong";
  // The rank change since the last answer (none in a duel: there are only two places).
  const before = first.duel ? undefined : new Map(places);
  first.players.forEach((p, i) => {
    places.set(p.name, i + 1);
  });
  return h(
    "article",
    { class: "question" },
    head(first),
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view),
    answered(q.view, r.answer, q.given ?? null),
    verdict(kind, r.points, r.missed ? "Без отговор." : undefined),
    r.answer.fact ? fact(r.answer.fact) : null,
    standings(view, true, before),
    () =>
      view().canLead
        ? h(
            "button",
            { class: "btn primary big", onclick: () => lead(code, "next", error.set) },
            last ? "Към класирането" : "Напред",
          )
        : null,
    waiting(view, last ? "покаже класирането" : "продължи"),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
    report(r.answer.id),
  );
}

/** The players by points; after an answer, what it brought each of them and how far they moved. */
function standings(view: () => RoomView, gains: boolean, before?: Map<string, number>): Child {
  return h("section", { class: "board" }, h("h2", null, "Класиране"), () =>
    h(
      "ol",
      null,
      view().players.map((p, i) => {
        const row = boardRow(
          i + 1,
          nameOf(p),
          gains && p.gained ? [h("small", { class: "sub" }, `+${p.gained} · `), String(p.points)] : String(p.points),
          { me: p.me },
        );
        if (!p.online) row.classList.add("away");
        if (before?.size) {
          row.classList.add("moves");
          row.append(move(before.get(p.name), i + 1));
        }
        return row;
      }),
    ),
  );
}

/** Places moved since the last answer: up, down, or none. */
function move(was: number | undefined, now: number): HTMLElement {
  const d = was === undefined ? 0 : was - now;
  if (d === 0) return h("span", { class: "delta", "aria-label": "без промяна" }, "–");
  return h(
    "span",
    { class: d > 0 ? "delta up" : "delta down", "aria-label": d > 0 ? `нагоре с ${d}` : `надолу с ${-d}` },
    h("span", { class: "i delta-sign", "aria-hidden": "true" }),
    String(Math.abs(d)),
  );
}

function end(view: () => RoomView, code: string): Child {
  const error = signal("");
  if (view().duel) {
    const v = view();
    const me = v.players.find((p) => p.me);
    const them = opponent(v);
    const result =
      !me || !them || me.points === them.points ? "Равенство" : me.points > them.points ? "Победа!" : "Загуба";
    return h(
      "div",
      { class: "screen" },
      h(
        "div",
        { class: "intro" },
        h("p", { class: "kicker" }, them ? `Дуел срещу ${nameOf(them)}` : "Дуел"),
        h("h1", null, result),
      ),
      standings(view, false),
      findDuel("Нов дуел"),
    );
  }
  return h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, () => `Стая ${spaced(code)} · ${topicName(view().category)}`),
      h("h1", null, () => {
        const [best] = view().players;
        return best ? `${best.name} печели` : "Край";
      }),
    ),
    standings(view, false),
    () =>
      view().canLead
        ? h("button", { class: "btn primary big", onclick: () => lead(code, "start", error.set) }, "Нова игра")
        : null,
    waiting(view, "започне нова игра"),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}
