// A room (or an arena, which is a room the server filled by itself): the lobby, then each question for everyone at once, its answer with the scores, and the final standings.
// The server sends the room as this player sees it after every change; the browser reconnects if the line drops.

import { answered, ask, picture } from "../game/questions.ts";
import { boardRow, review, shareButton } from "../game/results.ts";
import { questionHead, timer, upNext } from "../game/run.ts";
import type { Answer, Reveal, Reviewed, View } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, computed, effect, h, onCleanup, signal, untracked } from "../lib/dom.ts";
import { ordinal } from "../lib/ordinal.ts";
import { title } from "../lib/router.ts";
import { play } from "../lib/sound.ts";
import { categories, player, playing } from "../state.ts";
import { avatar, formatNumber, type Tier, type VerdictKind, verdict } from "../ui.ts";

interface RoomView {
  code: string;
  phase: "lobby" | "question" | "reveal" | "end";
  host: string;
  isHost: boolean;
  canLead: boolean;
  category: string;
  /** An arena: no host, it starts by itself after startsMs, and the places move ratings. */
  arena?: boolean;
  startsMs?: number;
  n: number;
  total: number;
  players: Player[];
  /** Once the game is over: its questions with this player's answers. */
  review?: Reviewed[];
  question?: {
    category: string;
    view: View;
    limitMs: number;
    leftMs: number;
    nextMs?: number;
    given?: Answer;
    reveal?: {
      answer: Reveal;
      points: number;
      speed?: number;
      row?: number;
      inRow?: number;
      right: boolean;
      exact?: boolean;
      missed?: boolean;
    };
  };
  /** Once the game is over: what this player's game earned for every answer right (in their points). */
  allRight?: number;
}

interface Player {
  /** Tells players apart in the room (names may repeat). */
  key: number;
  name: string;
  points: number;
  rights: number;
  online: boolean;
  answered: boolean;
  me?: boolean;
  gained?: number;
  right?: boolean;
  /** An arena's end: the player's place, and what it did to their rating (once known). */
  place?: number;
  delta?: number;
  avatar?: string;
  title?: string;
  titleTier?: Tier;
  level?: number;
}

const topicName = (id: string) => categories.find((c) => c.id === id)?.name ?? "Всички теми";
const spaced = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

/** An arena's game, at /arena/<code>. */
export function arenaGame(params: string[]) {
  return room(params, true);
}

export function room([code = ""]: string[], arena = false) {
  title(arena ? "Арена" : "Игра");
  const view = signal<RoomView | null>(null);
  const trouble = signal<"" | "reconnecting" | "gone" | "full">("");
  // Where each player stood at the last answer: how far they've moved since is the room's rank change.
  const places = new Map<number, number>();

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
  effect(() => {
    const phase = view()?.phase;
    playing.set(phase === "question" || phase === "reveal");
  });
  onCleanup(() => playing.set(false));
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
      trouble() === "gone" && arena
        ? h(
            "div",
            { class: "stack" },
            h("h1", null, "Тази арена свърши"),
            h("p", { class: "lead" }, "Или връзката с нея прекъсна. Влез в нова."),
            h("a", { class: "btn primary", href: "/arena" }, "Нова арена"),
          )
        : trouble() === "gone"
          ? h(
              "div",
              { class: "stack" },
              h("h1", null, "Няма такава стая"),
              h("p", { class: "lead" }, "Може кодът да е грешен или стаята да е затворена."),
              h("a", { class: "btn primary", href: "/room" }, "Отвори нова стая"),
            )
          : null,
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
          return v.arena ? arenaLobby(view as () => RoomView) : lobby(view as () => RoomView, code);
        case "question":
          return question(view as () => RoomView, code, v);
        case "reveal":
          return reveal(view as () => RoomView, v, places);
        case "end":
          return v.arena ? arenaEnd(view as () => RoomView) : end(view as () => RoomView, code);
      }
    },
  );
}

async function lead(code: string, action: "start", error: (s: string) => void) {
  try {
    await api("POST", `/api/rooms/${code}/${action}`);
  } catch (err) {
    error((err as ApiError).message);
  }
}

function waiting(view: () => RoomView, what: string): Child {
  return () => {
    const v = view();
    return v.canLead ? null : h("p", { class: "status" }, `Чакаме ${v.host} да ${what}.`);
  };
}

function lobby(view: () => RoomView, code: string): Child {
  const error = signal("");
  return h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, () => topicName(view().category)),
      h("h1", null, "Стая ", h("span", { class: "code-big" }, spaced(code))),
      h("p", { class: "lead" }, "Дай кода на другите или им прати връзката."),
    ),
    shareButton("Прати връзката", () => "Ела да играем на АЛМАНАХ:", `${location.origin}/r/${code}`, false),
    h(
      "section",
      { class: "card" },
      h("h2", { class: "section-title" }, () => `Играчи (${view().players.length})`),
      h("ul", { class: "players" }, () =>
        view().players.map((p) =>
          h(
            "li",
            { class: [!p.online && "away", p.me && "me"].filter(Boolean).join(" ") || undefined },
            avatar(p.avatar, { size: "s", name: p.name }),
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

/** An arena before its first question: who's in it, and the seconds to go. */
function arenaLobby(view: () => RoomView): Child {
  const left = signal(Math.ceil((untracked(view).startsMs ?? 0) / 1000));
  const tick = setInterval(() => left.update((n) => Math.max(0, n - 1)), 1000);
  onCleanup(() => clearInterval(tick));
  return h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Арена"),
      h("h1", null, () => (left() > 0 ? `Започваме след ${left()} с` : "Започваме…")),
      h("p", { class: "lead" }, "Който събере най-много точки, печели."),
    ),
    h(
      "section",
      { class: "card" },
      h("h2", { class: "section-title" }, () => `Играчи (${view().players.length})`),
      h("ul", { class: "players" }, () =>
        view().players.map((p) =>
          h(
            "li",
            { class: [!p.online && "away", p.me && "me"].filter(Boolean).join(" ") || undefined },
            avatar(p.avatar, { size: "s", name: p.name }),
            p.name,
            p.me ? " (ти)" : "",
          ),
        ),
      ),
    ),
  );
}

/** Which question, and its topic. */
function head(v: RoomView): Child {
  return questionHead(v.n, v.total, topicName(v.question?.category ?? ""));
}

function question(view: () => RoomView, code: string, first: RoomView): Child {
  const q = first.question;
  if (!q) return null;
  if (first.n === 0) play("ping"); // the game starts
  const locked = signal(!!q.given);
  const sent = signal(!!q.given);
  const left = signal(Math.ceil(q.leftMs / 1000));
  const error = signal("");
  const send = async (a: Answer) => {
    locked.set(true);
    try {
      await api("POST", `/api/rooms/${code}/answer`, { n: first.n, answer: a });
      sent.set(true);
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };
  const asked = ask(q.view, send, locked);
  // When the time is up, whatever has been put in (a typed number, things moved into order) is the answer.
  const tick = setInterval(() => {
    left.update((n) => Math.max(0, n - 1));
    if (left.peek() > 0 || locked.peek()) return;
    const pending = asked.pending();
    if (pending) send(pending);
    else locked.set(true);
  }, 1000);
  onCleanup(() => clearInterval(tick));
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

function reveal(view: () => RoomView, first: RoomView, places: Map<number, number>): Child {
  const q = first.question;
  const r = q?.reveal;
  if (!q || !r) return null;
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
  play(kind);
  // The rank change since the last answer.
  const before = new Map(places);
  first.players.forEach((p, i) => {
    places.set(p.key, i + 1);
  });
  return h(
    "article",
    { class: "question" },
    head(first),
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view),
    answered(q.view, r.answer, q.given ?? null),
    verdict(kind, r.points, r.missed ? "Без отговор." : undefined, r.speed, r.row, r.inRow),
    upNext(q.nextMs ?? 0, last ? "Към класирането…" : `Въпрос ${first.n + 2} след малко…`),
    standings(view, true, before),
  );
}

/** The players by points; after an answer, what it brought each of them and how far they moved. */
function standings(view: () => RoomView, gains: boolean, before?: Map<number, number>): Child {
  return h("section", { class: "board" }, h("h2", null, "Класиране"), () =>
    h(
      "ol",
      null,
      view().players.map((p, i) => {
        const row = boardRow(
          i + 1,
          p.name,
          gains && p.gained
            ? [h("small", { class: "sub" }, `+${formatNumber(p.gained)} · `), formatNumber(p.points)]
            : formatNumber(p.points),
          { me: p.me, look: p },
        );
        if (!p.online) row.classList.add("away");
        if (before?.size) {
          row.classList.add("moves");
          row.append(move(before.get(p.key), i + 1));
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

/** An arena's end: who won, the places with what each did to the rating, and the way to another. */
function arenaEnd(view: () => RoomView): Child {
  const first = untracked(view);
  const me = first.players.find((p) => p.me);
  play(me?.place === 1 ? "exact" : "right");
  return h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Арена"),
      h("h1", null, () => {
        const winners = view().players.filter((p) => p.place === 1);
        if (winners.length > 1)
          return winners.some((p) => p.me) ? "Делиш първото място!" : "Равенство за първото място";
        const [best] = winners;
        return !best ? "Край" : best.me ? "Ти печелиш!" : `${best.name} печели`;
      }),
      me?.place && me.place > 1
        ? h("p", { class: "place-line" }, `Ти си ${ordinal(me.place)} от ${first.players.length}.`)
        : null,
    ),
    h("section", { class: "board" }, h("h2", null, "Класиране"), () =>
      h(
        "ol",
        null,
        view().players.map((p, i) => {
          const row = boardRow(p.place ?? i + 1, p.name, String(p.points), { me: p.me, look: p });
          row.classList.add("moves");
          row.append(p.delta === undefined ? h("span", { class: "delta" }) : ratingChange(p.delta));
          return row;
        }),
      ),
    ),
    () => {
      const d = view().players.find((p) => p.me)?.delta;
      return d === undefined
        ? null
        : h(
            "p",
            { class: "status" },
            d === 0 ? "Рейтингът ти не се промени." : `Рейтинг: ${d > 0 ? "+" : "−"}${Math.abs(d)}.`,
          );
    },
    h(
      "div",
      { class: "actions" },
      h("a", { class: "btn primary big", href: "/arena" }, "Нова арена"),
      h("a", { class: "btn", href: "/" }, "Начало"),
    ),
    review(async () => view().review ?? []),
  );
}

/** What a place did to a rating: up, down, or none. */
function ratingChange(d: number): HTMLElement {
  if (d === 0) return h("span", { class: "delta", "aria-label": "рейтингът без промяна" }, "±0");
  return h(
    "span",
    { class: d > 0 ? "delta up" : "delta down", "aria-label": `рейтинг ${d > 0 ? "+" : "−"}${Math.abs(d)}` },
    `${d > 0 ? "+" : "−"}${Math.abs(d)}`,
  );
}

function end(view: () => RoomView, code: string): Child {
  const error = signal("");
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
    () =>
      view().allRight
        ? h("p", { class: "points-bonus" }, `Всички верни: +${formatNumber(view().allRight ?? 0)} т.`)
        : null,
    standings(view, false),
    () =>
      view().canLead
        ? h("button", { class: "btn primary big", onclick: () => lead(code, "start", error.set) }, "Нова игра")
        : null,
    waiting(view, "започне нова игра"),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
    review(async () => view().review ?? []),
  );
}
