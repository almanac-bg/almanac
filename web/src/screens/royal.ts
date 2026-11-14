// Роял: every evening at 21:00, live. Up to fifty players on the same question at the same moment, easy to hard in
// three rounds; the first wrong answer is the way out, and those out watch the rest to the end. The lobby opens a
// quarter of an hour before; whoever is on this screen at the start plays.
//
// The server sends the evening as this player sees it after every change; the browser reconnects if the line drops.

import { answered, ask, picture } from "../game/questions.ts";
import { review } from "../game/results.ts";
import { questionHead, timer, upNext } from "../game/run.ts";
import type { Answer, Reveal, Reviewed, View } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, computed, effect, h, onCleanup, type Signal, signal, untracked } from "../lib/dom.ts";
import { place } from "../lib/ordinal.ts";
import { title } from "../lib/router.ts";
import { play, playAnswer, playCount } from "../lib/sound.ts";
import { categories, player, playing, user } from "../state.ts";
import { avatar, back, pageArt, type Tier, type VerdictKind, verdict, who } from "../ui.ts";
import { type Standing, standingCard } from "./duel.ts";

type Phase = "soon" | "lobby" | "question" | "reveal" | "end";

interface Evening {
  phase: Phase;
  startsAt: number;
  opensAt: number;
  next: number;
  /** The server's clock when it sent this, for the countdowns. */
  now: number;
  length: number;
  round: number;
  size: number;
  /** In this tournament (its lobby, or its game); out of its game. */
  in: boolean;
  out: boolean;
  tables: number;
  n: number;
  entered: number;
  left: number;
  wentOut: number;
  players: Player[];
  question?: {
    category: string;
    view: View;
    limitMs: number;
    leftMs: number;
    nextMs?: number;
    given?: Answer;
    reveal?: {
      answer: Reveal;
      mine: boolean;
      points: number;
      speed?: number;
      right: boolean;
      exact?: boolean;
      missed?: boolean;
    };
  };
  runId?: number;
  place?: number;
  delta?: number;
}

interface Player {
  key: number;
  name: string;
  tag: string;
  in: boolean;
  reached: number;
  /** The question they went out on (-1: they haven't). */
  outAt: number;
  online: boolean;
  answered: boolean;
  place?: number;
  delta?: number;
  me?: boolean;
  avatar?: string;
  title?: string;
  titleTier?: Tier;
  level?: number;
}

interface Past {
  id: number;
  length: number;
  startsAt: number;
  players: { name: string; reached: number; place: number; delta?: number; me?: boolean }[];
}

const topicName = (id: string) => categories.find((c) => c.id === id)?.name ?? "";
const clock = (ms: number) =>
  new Intl.DateTimeFormat("bg", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Sofia" }).format(new Date(ms));
const dayOf = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Europe/Sofia" });

/** When an evening is, in words: „днес в 21:00“, „утре в 21:00“, or its weekday. */
function when(ms: number, now: number): string {
  const day = dayOf(ms);
  if (day === dayOf(now)) return `днес в ${clock(ms)}`;
  if (day === dayOf(now + 24 * 3600_000)) return `утре в ${clock(ms)}`;
  const weekday = new Intl.DateTimeFormat("bg", { weekday: "long", timeZone: "Europe/Sofia" }).format(new Date(ms));
  return `${weekday} в ${clock(ms)}`;
}

/** Time left, in words for hours, as a clock for the last hour (12:05). */
function left(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) {
    const m = Math.ceil(s / 60);
    return `${Math.floor(m / 60)} ч и ${m % 60} мин`;
  }
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** How far a player got, in words. */
function reach(p: Player | Past["players"][number], length: number): string {
  if (p.reached >= length) return `всичките ${length}!`;
  return `отпадна на въпрос ${p.reached + 1}`;
}

const signed = (d: number) => `${d > 0 ? "+" : ""}${d}`;
const delta = (d?: number) => (d ? h("span", { class: d > 0 ? "delta up" : "delta down" }, signed(d)) : null);

export function royal() {
  title("Роял");
  const view = signal<Evening | null>(null);
  const trouble = signal(false);
  // The server's clock less this one's: the countdowns go by the server's.
  let skew = 0;
  const now = signal(Date.now());
  const tick = setInterval(() => now.set(Date.now() + skew), 1000);
  onCleanup(() => clearInterval(tick));

  let es: EventSource | null = null;
  // The stream follows the evening as whoever is signed in sees it: again once someone who only looked becomes a
  // player, by joining.
  let as = user.peek()?.id ?? 0;
  const connect = () => {
    es?.close();
    es = new EventSource("/api/royal/events");
    es.onmessage = (e) => {
      const v = JSON.parse(e.data) as Evening;
      skew = v.now - Date.now();
      now.set(v.now);
      trouble.set(false);
      view.set(v);
    };
    es.onerror = () => trouble.set(true); // the browser tries again by itself
  };
  const joined = () => {
    const id = user.peek()?.id ?? 0;
    if (id !== as) {
      as = id;
      connect();
    }
  };
  connect();
  onCleanup(() => es?.close());

  effect(() => {
    const phase = view()?.phase;
    playing.set(phase === "question" || phase === "reveal");
  });
  onCleanup(() => playing.set(false));

  // Each phase (and each question) is drawn once; what changes inside it follows the view.
  const key = computed(() => {
    const v = view();
    return v ? `${v.phase}:${v.n}:${v.in}:${v.startsAt}` : "";
  });
  return h(
    "div",
    { class: "screen" },
    () => (trouble() ? h("p", { class: "status", role: "status" }, "Връзката прекъсна. Свързваме се отново…") : null),
    () => {
      if (!key()) return h("p", { class: "muted" }, "…");
      const v = untracked(view) as Evening;
      const live = view as () => Evening;
      switch (v.phase) {
        case "soon":
          return soon(live, now);
        case "lobby":
          return lobby(live, now, joined);
        case "question":
          return question(live, v);
        case "reveal":
          return reveal(live, v);
        case "end":
          return end(live, v, now);
      }
    },
  );
}

const about =
  "Всяка вечер в 21:00. До 50 души на едни и същи петнадесет въпроса, в един и същи миг — от лесни към трудни, в три кръга. Първият грешен отговор те изважда.";

/** Before the lobby opens: when the next one is, your rating, and how your last ones went. */
function soon(view: () => Evening, now: Signal<number>): Child {
  const past = signal<{ royals: Past[]; standing: Standing } | null>(null);
  if (user.peek()) api<{ royals: Past[]; standing: Standing }>("GET", "/api/royal").then(past.set, () => {});
  return h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      back("/", "Начало"),
      pageArt("royal", "tone-gold"),
      h("h1", null, "Роял"),
      h("p", { class: "muted" }, about),
    ),
    h(
      "section",
      { class: "card royal-next" },
      h("p", { class: "kicker" }, "Следващият Роял"),
      h("strong", { class: "royal-when" }, () => when(view().startsAt, now())),
      h(
        "p",
        { class: "muted" },
        () => `Входът се отваря в ${clock(view().opensAt)}, след ${left(view().opensAt - now())}.`,
      ),
    ),
    () => {
      const d = past();
      return d ? [standingCard(d.standing), history(d.royals)] : null;
    },
  );
}

/** The last evenings you played. */
function history(list: Past[]): Child {
  if (!list.length) return null;
  return h(
    "section",
    { class: "stack" },
    h("h2", { class: "section-title" }, "Последните ти"),
    h(
      "ul",
      { class: "duel-list" },
      list.map((t) => {
        const me = t.players.find((p) => p.me);
        return h(
          "li",
          { class: "duel-row" },
          h(
            "span",
            { class: "royal-past" },
            h("strong", null, me ? place(me.place, t.players.length) : "—"),
            h(
              "span",
              { class: "muted" },
              new Date(t.startsAt).toLocaleDateString("bg", { day: "numeric", month: "long" }),
            ),
          ),
          h(
            "span",
            { class: "duel-row-end" },
            h("span", { class: "muted" }, me ? reach(me, t.length) : ""),
            delta(me?.delta),
          ),
        );
      }),
    ),
  );
}

/** The players as chips with their avatars: those still in, and (dimmer) those out. */
function chips(players: Player[], note: (p: Player) => string = () => ""): Child {
  return h(
    "ul",
    { class: "players" },
    players.map((p) =>
      h(
        "li",
        { class: [!p.in && "away", p.me && "me"].filter(Boolean).join(" ") || undefined },
        avatar(p.avatar, { size: "s", name: p.name }),
        p.name,
        p.me ? " (ти)" : "",
        note(p),
      ),
    ),
  );
}

function lobby(view: () => Evening, now: Signal<number>, joined: () => void): Child {
  const error = signal("");
  const busy = signal(false);
  const act = async (method: "POST" | "DELETE") => {
    error.set("");
    busy.set(true);
    try {
      await player();
      await api(method, "/api/royal", method === "POST" ? {} : undefined);
      joined();
    } catch (err) {
      error.set((err as ApiError).message);
    } finally {
      busy.set(false);
    }
  };
  const v0 = view();
  // Those in hear the last three seconds.
  let heard = 0;
  effect(() => {
    const s = Math.ceil((view().startsAt - now()) / 1000);
    if (s === heard || !untracked(view).in) return;
    heard = s;
    playCount(s);
  });
  return h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      back("/", "Начало"),
      h(
        "h1",
        null,
        "Роял започва след ",
        h("span", { class: "royal-count" }, () => left(view().startsAt - now())),
      ),
      h(
        "p",
        { class: "lead" },
        v0.in
          ? `Вътре си. Остани на този екран: в ${clock(v0.startsAt)} играят тези, които са тук.`
          : `В ${clock(v0.startsAt)} всички получават първия въпрос едновременно. Грешният отговор те изважда.`,
      ),
    ),
    v0.in
      ? h("button", { class: "btn", type: "button", disabled: busy, onclick: () => act("DELETE") }, "Излез")
      : h("button", { class: "btn primary big", type: "button", disabled: busy, onclick: () => act("POST") }, "Влизам"),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
    () => {
      const v = view();
      if (!v.players.length) return h("p", { class: "muted" }, "Още никой не е влязъл.");
      return h(
        "section",
        { class: "card" },
        h(
          "h2",
          { class: "section-title" },
          `Вътре: ${v.players.length} от ${v.size}`,
          v.tables > 1 ? h("span", { class: "muted" }, ` · тази вечер ${v.tables} турнира`) : null,
        ),
        chips(v.players.map((p) => ({ ...p, in: p.online || !!p.me }))),
      );
    },
  );
}

/** Which question, of which round, and its topic. */
function head(v: Evening): Child {
  const round = Math.floor(v.n / v.round) + 1;
  return questionHead(v.n, v.length, `Кръг ${round} · ${topicName(v.question?.category ?? "")}`);
}

/** How many are still in, of how many began. */
function still(view: () => Evening): Child {
  return h("p", { class: "royal-left" }, () => {
    const v = view();
    return `В играта: ${v.left} от ${v.entered}`;
  });
}

function question(view: () => Evening, first: Evening): Child {
  const q = first.question;
  if (!q) return null;
  if (first.n === 0 && first.in) play("go"); // the game starts
  const plays = first.in && !first.out;
  const locked = signal(!plays || !!q.given);
  const sent = signal(!!q.given);
  const secs = signal(Math.ceil(q.leftMs / 1000));
  const error = signal("");
  const send = async (a: Answer) => {
    locked.set(true);
    try {
      await api("POST", "/api/royal/answer", { n: first.n, answer: a });
      sent.set(true);
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };
  const asked = ask(q.view, send, locked);
  const tick = setInterval(() => {
    secs.update((n) => Math.max(0, n - 1));
    if (secs.peek() > 0 || locked.peek()) return;
    const pending = asked.pending();
    if (pending) send(pending);
    else locked.set(true);
  }, 1000);
  onCleanup(() => clearInterval(tick));
  return h(
    "article",
    { class: "question" },
    head(first),
    timer(q.leftMs, q.limitMs, secs, plays ? locked : signal(false)), // a watcher's clock runs to the end
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view),
    asked.node,
    () => {
      const v = view();
      const waiting = v.players.filter((p) => p.in || p.outAt === v.n);
      const done = waiting.filter((p) => p.answered).length;
      return h(
        "p",
        { class: "status", role: "status" },
        !plays ? "Гледаш. " : sent() ? "Отговорът ти е приет. " : "",
        `Отговориха ${done} от ${waiting.length}.`,
      );
    },
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
    still(view),
  );
}

function reveal(view: () => Evening, first: Evening): Child {
  const q = first.question;
  const r = q?.reveal;
  if (!q || !r) return null;
  const kind: VerdictKind = r.missed ? "time" : r.exact ? "exact" : r.right ? "right" : "wrong";
  if (r.mine) playAnswer(kind, first.n + 1); // to be still in, every answer before was right
  const last = first.n + 1 >= first.length || first.left === 0;
  return h(
    "article",
    { class: "question" },
    head(first),
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view),
    answered(q.view, r.answer, r.mine ? (q.given ?? null) : null),
    r.mine
      ? verdict(kind, r.points, r.missed ? "Без отговор. Отпадаш." : r.right ? undefined : "Отпадаш.", r.speed)
      : null,
    h(
      "p",
      { class: "royal-left" },
      first.wentOut === 0
        ? "Никой не отпадна. "
        : first.wentOut === 1
          ? "Отпадна един. "
          : `Отпаднаха ${first.wentOut}. `,
      first.left === 0
        ? "Не остана никой."
        : first.left === 1
          ? `Остава един от ${first.entered}.`
          : `Остават ${first.left} от ${first.entered}.`,
    ),
    upNext(q.nextMs ?? 0, last ? "Към класирането…" : `Въпрос ${first.n + 2} след малко…`),
    () => {
      const v = view();
      return chips(v.players, (p) => (p.in ? "" : ` · отпадна на ${p.outAt + 1}`));
    },
  );
}

function end(view: () => Evening, first: Evening, now: Signal<number>): Child {
  const me = first.players.find((p) => p.me);
  const [best] = first.players;
  const won = me?.place === 1 && first.entered > 1;
  if (me) play(won ? "win" : "end");
  return h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Роял"),
      h(
        "h1",
        null,
        won
          ? "Печелиш Роял!"
          : me
            ? first.entered > 1 && me.place
              ? place(me.place, first.entered)
              : "Роял свърши"
            : best
              ? `${best.name} печели`
              : "Край",
      ),
      me
        ? h(
            "p",
            { class: "lead" },
            me.reached >= first.length ? `Всичките ${first.length} верни.` : `Отпадна на въпрос ${me.reached + 1}.`,
            first.entered >= 3 && first.delta ? ` Рейтинг: ${signed(first.delta)}.` : "",
          )
        : null,
    ),
    h(
      "section",
      { class: "board royal-table" },
      h("h2", null, "Класиране"),
      h(
        "ol",
        null,
        first.players.map((p) =>
          h(
            "li",
            { class: ["row", (p.place ?? 9) <= 3 && `p${p.place}`, p.me && "me"].filter(Boolean).join(" ") },
            h("span", { class: "place" }, String(p.place ?? "")),
            who(p.name, p, p.me ? h("span", { class: "you" }, "ти") : null, p.name, p.tag),
            h("span", { class: "royal-reach" }, h("span", { class: "muted" }, reach(p, first.length)), delta(p.delta)),
          ),
        ),
      ),
    ),
    h("p", { class: "muted" }, () => `Следващият Роял: ${when(view().next, now())}.`),
    first.runId
      ? review(async () => (await api<{ questions: Reviewed[] }>("GET", `/api/runs/${first.runId}/review`)).questions)
      : null,
  );
}
