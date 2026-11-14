// A live duel: waiting for someone (or, after 10 seconds, a recording of a real game), the two face to face, then
// each question for both at the same moment — the other's answer comes in as they give it, and shows with yours —
// and the result. The server sends the duel as this player sees it after every change; the browser reconnects if
// the line drops, and comes back to the same duel.

import { emblem } from "../art/emblem.ts";
import { news } from "../game/news.ts";
import { answered, ask, picture } from "../game/questions.ts";
import { questionHead, timer, trail, upNext } from "../game/run.ts";
import type { Answer, Mark, Reveal, View } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, computed, effect, h, onCleanup, signal, untracked } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { play, playAnswer, playCount } from "../lib/sound.ts";
import { categories, player, playing } from "../state.ts";
import { avatar, formatNumber, type Tier, type VerdictKind, verdict } from "../ui.ts";
import { type DuelView, ended } from "./duel.ts";

interface Side {
  name: string;
  tag?: string;
  avatar?: string;
  title?: string;
  titleTier?: Tier;
  level?: number;
  rating: number;
  division: "bronze" | "silver" | "gold" | "platinum" | "diamond" | "legend";
  points: number;
  rights: number;
  trail: Mark[];
  online: boolean;
  answered: boolean;
  tookMs?: number;
  /** The other's answer, as shown, once both answers show. */
  given?: Answer;
  gained?: number;
  right?: boolean;
  missed?: boolean;
}

interface LiveView {
  id: number;
  phase: "intro" | "question" | "reveal" | "end" | "off";
  n: number;
  total: number;
  recorded?: boolean;
  you: Side;
  them: Side;
  startsMs?: number;
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
}

type Trouble = "" | "reconnecting" | "closed" | "nobody" | "busy";

const topicName = (id: string) => categories.find((c) => c.id === id)?.name ?? "";
const divisionNames: Record<Side["division"], string> = {
  bronze: "Бронз",
  silver: "Сребро",
  gold: "Злато",
  platinum: "Платина",
  diamond: "Диамант",
  legend: "Легенда",
};
/** Seconds, the Bulgarian way: „4,2 с“. */
const seconds = (ms: number) => `${(ms / 1000).toLocaleString("bg", { maximumFractionDigits: 1 })} с`;

export function liveDuel() {
  title("Дуел");
  const round = signal(0);
  // „Още един дуел“ starts over in place: a new wait, a new duel.
  return h("div", null, () => {
    round();
    return untracked(() => session(() => round.update((n) => n + 1)));
  });
}

/** One duel, from asking for it to its result. */
function session(again: () => void): Child {
  const view = signal<LiveView | null>(null);
  const waitMs = signal<number | null>(null);
  const trouble = signal<Trouble>("");

  let es: EventSource | null = null;
  const stop = () => es?.close();
  player()
    .then(() => {
      es = new EventSource("/api/duels/live/events");
      es.addEventListener("waiting", (e) => {
        trouble.set("");
        // A line that dropped while waiting starts the wait again; a duel that ended doesn't come back.
        if (view.peek()) return stop();
        waitMs.set(JSON.parse((e as MessageEvent).data).leftMs);
      });
      es.onmessage = (e) => {
        trouble.set("");
        const v: LiveView = JSON.parse(e.data);
        view.set(v);
        if (v.phase === "end" || v.phase === "off") stop();
      };
      for (const event of ["closed", "nobody", "busy"] as const)
        es.addEventListener(event, () => {
          stop();
          trouble.set(event);
        });
      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED) trouble.set("closed");
        else trouble.set("reconnecting"); // the browser tries again by itself
      };
    })
    .catch(() => trouble.set("busy"));
  onCleanup(stop);
  effect(() => {
    const phase = view()?.phase;
    playing.set(phase === "question" || phase === "reveal");
  });
  onCleanup(() => playing.set(false));

  // Each phase (and each question) is drawn once; what changes inside it follows the view.
  const key = computed(() => {
    const v = view();
    return v ? `${v.phase}:${v.n}` : waitMs() !== null ? "waiting" : "";
  });
  return h(
    "div",
    { class: "screen live" },
    () =>
      trouble() === "reconnecting"
        ? h("p", { class: "status", role: "status" }, "Връзката прекъсна. Свързваме се отново…")
        : null,
    () => {
      const k = key();
      const t = trouble();
      if (t === "nobody") return nobody(again);
      if (t === "busy") return problem("Твърде много дуели в момента", "Опитай след малко.", again);
      if (t === "closed" && untracked(view)?.phase !== "end")
        return problem("Дуелът прекъсна", "Без резултат: рейтингът не се мени.", again);
      if (!k) return h("p", { class: "muted" }, "…");
      if (k === "waiting") return waiting(untracked(waitMs) ?? 0);
      const v = untracked(view) as LiveView;
      const live = view as () => LiveView;
      switch (v.phase) {
        case "intro":
          return intro(v);
        case "question":
          return question(live, v);
        case "reveal":
          return reveal(live, v);
        case "end":
          return end(v, again);
        case "off":
          return problem("Съперникът не дойде", "Дуелът е без резултат. Потърси нов.", again);
      }
    },
  );
}

/** Waiting for someone: how long until a recording instead. */
function waiting(leftMs: number): Child {
  const left = signal(Math.ceil(leftMs / 1000));
  const tick = setInterval(() => left.update((n) => Math.max(0, n - 1)), 1000);
  onCleanup(() => clearInterval(tick));
  return h(
    "div",
    { class: "stack live-wait" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Дуел на живо"),
      h("h1", null, "Търсим съперник"),
      h("p", { class: "lead" }, () =>
        left() > 0
          ? "Ако никой не дойде до края на броенето, ще играеш срещу запис на истинска игра."
          : "Намираме ти запис на истинска игра…",
      ),
    ),
    h(
      "p",
      { class: "live-count", role: "timer", "aria-label": () => `${left()} ${left() === 1 ? "секунда" : "секунди"}` },
      () => String(left()),
    ),
    h("button", { class: "btn", type: "button", onclick: () => go("/duel") }, "Откажи"),
  );
}

/** The two, face to face, before the first question: a ping as the other is found, a beep for each of the last
 * seconds. */
function intro(v: LiveView): Child {
  play("ping");
  const left = signal(Math.max(1, Math.ceil((v.startsMs ?? 0) / 1000)));
  const tick = setInterval(() => {
    const was = left.peek();
    left.update((n) => Math.max(1, n - 1));
    if (left.peek() < was) playCount(left.peek());
  }, 1000);
  onCleanup(() => clearInterval(tick));
  const card = (s: Side, label: string) =>
    h(
      "div",
      { class: `live-face d-${s.division}` },
      avatar(s.avatar, { size: "l", level: s.level, name: s.name }),
      h("strong", { class: "live-name" }, s.name),
      h("span", { class: "kicker" }, label),
      h("span", { class: "live-division" }, emblem(s.division, "s"), `${divisionNames[s.division]} · ${s.rating}`),
    );
  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Дуел на живо"),
      h("h1", null, v.recorded ? "Срещу запис" : "Съперникът е тук"),
      v.recorded
        ? h(
            "p",
            { class: "lead" },
            `Никой не дойде навреме. Играеш срещу запис на игра на ${v.them.name}: всеки отговор идва в мига, в който е даден.`,
          )
        : null,
    ),
    h(
      "section",
      { class: "card live-faces" },
      card(v.you, "Ти"),
      h("span", { class: "live-vs", "aria-hidden": "true" }, "срещу"),
      card(v.them, v.recorded ? "Запис" : "Съперник"),
    ),
    h("p", { class: "status", role: "status" }, () => `Започваме след ${left()}…`),
  );
}

/** Both sides at a glance: points, how each answer went, and how the other is doing on this question. */
function scoreboard(view: () => LiveView, total: number): Child {
  const side = (s: () => Side, mine: boolean) =>
    h(
      "div",
      { class: mine ? "live-side me" : "live-side" },
      h(
        "div",
        { class: "live-who" },
        () => avatar(s().avatar, { size: "s", name: s().name }),
        h("span", { class: "live-side-name" }, () => (mine ? "Ти" : s().name)),
        h("b", { class: "live-points" }, () => formatNumber(s().points)),
      ),
      () => trail(s().trail, total, view().phase === "question" ? view().n : -1),
      mine ? null : () => h("p", { class: "live-doing", role: "status" }, doing(view(), s())),
    );
  return h(
    "section",
    { class: "live-board", "aria-label": "Резултат" },
    side(() => view().you, true),
    side(() => view().them, false),
  );
}

/** What the other is doing on the question now: thinking, answered (and how fast), or gone for a moment. */
function doing(v: LiveView, s: Side): string {
  if (v.phase !== "question") return "";
  if (s.answered) return `Отговори за ${seconds(s.tookMs ?? 0)}`;
  if (!s.online) return "Връзката на съперника прекъсна…";
  return "Мисли…";
}

function question(view: () => LiveView, first: LiveView): Child {
  const q = first.question;
  if (!q) return null;
  if (first.n === 0) play("go"); // the game starts
  const locked = signal(!!q.given);
  const sent = signal(!!q.given);
  const left = signal(Math.ceil(q.leftMs / 1000));
  const error = signal("");
  const send = async (a: Answer) => {
    locked.set(true);
    try {
      await api("POST", `/api/duels/live/${first.id}/answer`, { n: first.n, answer: a });
      sent.set(true);
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };
  const asked = ask(q.view, send, locked);
  // More of the question shows as its time runs (the next clue): the server sends it when it's due.
  effect(() => {
    const v = view();
    if (v.n === first.n && v.question) asked.update?.(v.question.view);
  });
  // When the time is up, whatever has been put in (a typed number, things moved into order) is the answer.
  const tick = setInterval(() => {
    left.update((n) => Math.max(0, n - 1));
    if (left.peek() > 0 || locked.peek()) return;
    const pending = asked.pending();
    if (pending) send(pending);
    else locked.set(true);
  }, 1000);
  onCleanup(() => clearInterval(tick));
  // The other answering is news: a sound of its own, not a tap the player might take for theirs.
  let heard = first.them.answered;
  effect(() => {
    if (view().them.answered && !heard) {
      heard = true;
      play("them");
    }
  });
  return h(
    "article",
    { class: "question" },
    questionHead(first.n, first.total, topicName(q.category)),
    scoreboard(view, first.total),
    timer(q.leftMs, q.limitMs, left, locked),
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view, true),
    asked.node,
    () =>
      sent()
        ? h(
            "p",
            { class: "status", role: "status" },
            view().them.answered ? "Отговорите идват…" : `Отговорът ти е приет. Чакаме ${view().them.name}.`,
          )
        : null,
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

function reveal(view: () => LiveView, first: LiveView): Child {
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
  playAnswer(kind, r.inRow);
  return h(
    "article",
    { class: "question" },
    questionHead(first.n, first.total, topicName(q.category)),
    scoreboard(view, first.total),
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view, true),
    answered(q.view, r.answer, q.given ?? null),
    verdict(kind, r.points, r.missed ? "Без отговор." : undefined, r.speed, r.row, r.inRow),
    theirs(first.them, q.view),
    upNext(q.nextMs ?? 0, last ? "Към резултата…" : `Въпрос ${first.n + 2} след малко…`),
  );
}

/** How the other answered: what they gave (where it says itself in a few words), how it went, what it brought. */
function theirs(s: Side, v: View): Child {
  const how = s.missed ? "missed" : s.right ? "right" : s.gained ? "partial" : "wrong";
  const words = { missed: "без отговор", right: "вярно", partial: "близо", wrong: "грешно" }[how];
  let gave = "";
  const g = s.given as Record<string, unknown> | undefined;
  if (g && v.type === "choice" && typeof g.pick === "number" && v.choices) gave = `„${v.choices[g.pick]}“`;
  else if (g && v.type === "truefalse" && typeof g.truth === "boolean") gave = g.truth ? "„Вярно“" : "„Невярно“";
  else if (g && v.type === "number" && typeof g.value === "number")
    gave = `${formatNumber(g.value, v.step)}${v.unit ? ` ${v.unit}` : ""}`;
  return h(
    "p",
    { class: `live-theirs h-${how}` },
    avatar(s.avatar, { size: "s", name: s.name }),
    h(
      "span",
      null,
      h("strong", null, s.name),
      gave ? ` отговори ${gave}` : "",
      s.tookMs && !s.missed ? ` за ${seconds(s.tookMs)}` : "",
    ),
    h("span", { class: "live-theirs-how" }, h("span", { class: "live-theirs-sign", "aria-hidden": "true" }), words),
    s.gained ? h("b", { class: "live-theirs-points" }, `+${formatNumber(s.gained)}`) : null,
  );
}

/** The result, as the duel was kept: who won, the scores, the rating it moved, what the game earned; then the
 * questions to go over. */
function end(v: LiveView, again: () => void): Child {
  const kept = signal<DuelView | null>(null);
  const error = signal("");
  api<{ duels: DuelView[] }>("GET", "/api/duels").then(
    (r) => {
      const d = r.duels.find((x) => x.id === v.id);
      if (d) {
        play(d.state === "won" ? "win" : d.state === "lost" ? "lose" : "end");
        kept.set(d);
      } else error.set("Резултатът още се записва. Виж го след малко в дуелите си.");
    },
    (err) => error.set((err as ApiError).message),
  );
  const more = (d: DuelView) => [
    h("button", { class: "btn primary big", type: "button", onclick: again }, "Още един дуел"),
    d.runId ? news(d.runId) : null,
  ];
  return h("div", null, () => {
    const d = kept();
    if (d) return ended(d, more(d));
    return error() ? problem("Дуелът свърши", error(), again) : h("p", { class: "muted" }, "…");
  });
}

function nobody(again: () => void): Child {
  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "intro" },
      h("h1", null, "Точно сега няма с кого"),
      h(
        "p",
        { class: "lead" },
        "Никой не търси дуел, а записи на игри още няма. Опитай пак след малко или предизвикай приятел.",
      ),
    ),
    h("button", { class: "btn primary big", type: "button", onclick: again }, "Опитай пак"),
    h("a", { class: "btn", href: "/duel" }, "Към дуелите"),
  );
}

function problem(heading: string, lead: string, again: () => void): Child {
  return h(
    "div",
    { class: "stack" },
    h("div", { class: "intro" }, h("h1", null, heading), h("p", { class: "lead" }, lead)),
    h("button", { class: "btn primary big", type: "button", onclick: again }, "Потърси нов дуел"),
    h("a", { class: "btn", href: "/duel" }, "Към дуелите"),
  );
}
