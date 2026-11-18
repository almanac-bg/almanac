// A live duel: waiting for someone (or, after 10 seconds, a recording of a real game), the two face to face, then
// each question for both at the same moment — the other's answer comes in as they give it, and shows with yours —
// and the result. The server sends the duel as this player sees it after every change; the browser reconnects if
// the line drops, and comes back to the same duel.
//
// It loads on its own, the first time a live duel opens, and is handed the app's pieces (kit.ts): it imports only types.

import type { Answer, Mark, Reveal, View } from "../game/types.ts";
import type { Kit } from "../kit.ts";
import type { ApiError } from "../lib/api.ts";
import type { Child } from "../lib/dom.ts";
import type { Tier, VerdictKind } from "../ui.ts";
import type { DuelView } from "./duel.ts";

// The app's pieces, set as the screen opens (liveDuel).
let {
  answered,
  api,
  ask,
  avatar,
  byTap,
  computed,
  countdown,
  crowdLine,
  deliver,
  effect,
  errorText,
  duelResult,
  emblem,
  formatNumber,
  go,
  goBack,
  guardLeaving,
  h,
  keepAwake,
  lifetime,
  loadDuelResult,
  news,
  onCleanup,
  picture,
  play,
  playAnswer,
  playCount,
  player,
  playing,
  questionHead,
  readyClock,
  shareButton,
  signal,
  startScreen,
  staying,
  timer,
  title,
  topics,
  trail,
  untracked,
  upNext,
  verdict,
} = {} as Kit;

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
  /** Away longer than the duel waits: it goes on without them. */
  gone?: boolean;
  answered: boolean;
  /** Asks for a rematch, the duel over: the other has a moment to ask too. */
  rematch?: boolean;
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
  /** Against a recording of a game in one topic: which. */
  topic?: string;
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

type Trouble = "" | "reconnecting" | "closed" | "nobody" | "busy" | "norematch" | "paused";

/** Waiting for someone: how long until a recording, or that the game is being updated (held: the duel starts on the
 * new version, the line coming back to it by itself). */
interface Wait {
  leftMs: number;
  held?: boolean;
}

const topicName = (id: string) => topics.find((c) => c.id === id)?.name ?? "";
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

export function liveDuel(kit: Kit) {
  ({
    answered,
    api,
    ask,
    avatar,
    byTap,
    computed,
    countdown,
    crowdLine,
    deliver,
    effect,
    errorText,
    duelResult,
    emblem,
    formatNumber,
    go,
    goBack,
    guardLeaving,
    h,
    keepAwake,
    lifetime,
    loadDuelResult,
    news,
    onCleanup,
    picture,
    play,
    playAnswer,
    playCount,
    player,
    playing,
    questionHead,
    readyClock,
    shareButton,
    signal,
    startScreen,
    staying,
    timer,
    title,
    topics,
    trail,
    untracked,
    upNext,
    verdict,
  } = kit);
  title("Дуел");
  // Opened by a tap, the search starts at once; come to otherwise (a reload, back or forward, a link), only to go back
  // into a duel under way: else „Намери съперник“ first, so that back to a duel's result never starts another.
  // The round: each a search of its own (-1: not known yet whether a duel is under way; 0: none started).
  const round = signal<{ n: number; rematch?: Rematch }>({ n: byTap() ? 1 : -1 });
  if (round.peek().n < 0)
    api<{ playing: { kind: string } | null }>("GET", "/api/playing").then(
      (p) => round.set({ n: p.playing?.kind === "duel" ? 1 : 0 }),
      () => round.set({ n: 0 }),
    );
  // „Още един дуел“ starts over in place: a new wait, a new duel; „Реванш“ too, with the one just played.
  const again = (rematch?: Rematch) => round.update((r) => ({ n: Math.max(1, r.n + 1), rematch }));
  return h("div", null, () => {
    const r = round();
    if (r.n < 0) return h("p", { class: "muted" }, "…");
    if (!r.n)
      return startScreen(
        "Дуел на живо",
        "Ти и друг играч: едни и същи десет въпроса, в един и същ миг.",
        null,
        () => again(),
        "Намери съперник",
      );
    return untracked(() => session(again, r.rematch));
  });
}

/** A rematch asked for: of which duel, with whom. */
interface Rematch {
  id: number;
  name: string;
}

/** One duel, from asking for it (with whoever comes, or for a rematch with the one just played) to its result. */
function session(again: (rematch?: Rematch) => void, rematch?: Rematch): Child {
  const view = signal<LiveView | null>(null);
  const wait = signal<Wait | null>(null);
  const trouble = signal<Trouble>("");

  let es: EventSource | null = null;
  const stop = () => es?.close();
  onCleanup(stop);
  // Over, the result stays: a stream that ends then (the duel forgotten) or drops doesn't take it away.
  const over = () => view.peek()?.phase === "end";
  // The screen gone before the player was made (a first-time guest): no stream, which would join the queue.
  const life = lifetime();
  // Waiting for an opponent, a reload of the page (a new version of the game: fresh.ts) would lose the place in the
  // queue: it waits for the next screen.
  staying(() => !!wait.peek() && !view.peek());
  player()
    .then(() => {
      if (life.aborted) return;
      es = new EventSource(`/api/duels/live/events${rematch ? `?rematch=${rematch.id}` : ""}`);
      es.addEventListener("waiting", (e) => {
        trouble.set("");
        // A line that dropped while waiting starts the wait again; a duel that ended doesn't come back.
        if (view.peek()) return stop();
        wait.set(JSON.parse((e as MessageEvent).data));
      });
      es.onmessage = (e) => {
        trouble.set("");
        const v: LiveView = JSON.parse(e.data);
        view.set(v);
        // Over, it's still followed for a while: the other may ask for a rematch.
        if (v.phase === "off") stop();
      };
      for (const event of ["closed", "nobody", "busy", "norematch", "paused"] as const)
        es.addEventListener(event, () => {
          stop();
          if (!over()) trouble.set(event);
        });
      es.onerror = () => {
        if (over()) stop();
        else if (es?.readyState === EventSource.CLOSED) trouble.set("closed");
        else trouble.set("reconnecting"); // the browser tries again by itself
      };
    })
    .catch(() => trouble.set("busy"));
  effect(() => {
    const phase = view()?.phase;
    playing.set(phase === "question" || phase === "reveal");
  });
  onCleanup(() => playing.set(false));
  // The screen stays on from the wait for an opponent to the result: a phone asleep drops the duel.
  // Leaving mid-duel costs it (live.go): the duel goes on without the player, their time running out on each question,
  // and its result counts. Every way out asks first; a leave confirmed is told the server at once, so that the other
  // isn't kept waiting for this player's line to drop (it goes all the same if that can't be said).
  const leaveAsk = guardLeaving(
    "Излизаш от дуела? Той продължава без теб: въпросите остават без отговор, а резултатът се брои.",
    () => {
      const phase = view()?.phase;
      return phase === "question" || phase === "reveal";
    },
    async (on) => {
      const id = view.peek()?.id;
      if (id) await api("POST", `/api/duels/live/${id}/leave`).catch(() => {});
      on();
    },
  );
  keepAwake(() => {
    const phase = view()?.phase;
    return phase ? phase !== "end" && phase !== "off" : wait() !== null;
  });

  // Each phase (and each question) is drawn once; what changes inside it follows the view.
  const key = computed(() => {
    const v = view();
    return v ? `${v.phase}:${v.n}` : wait() !== null ? "waiting" : "";
  });
  return h(
    "div",
    { class: "screen live" },
    leaveAsk,
    () =>
      trouble() === "reconnecting"
        ? h("p", { class: "status", role: "status" }, "Връзката прекъсна. Свързваме се отново…")
        : null,
    () => {
      const k = key();
      const t = trouble();
      const anew = () => again();
      if (t === "nobody") return nobody(anew);
      if (t === "busy") return problem("Твърде много дуели в момента", "Опитай след малко.", anew);
      if (t === "norematch")
        return problem("Реванш няма да има", `${rematch?.name ?? "Съперникът"} не поиска реванш навреме.`, anew);
      if (t === "paused")
        return problem(
          "Играта се обновява",
          "Реванш сега не става. Потърси нов дуел: започва веднага след обновяването.",
          anew,
        );
      if (t === "closed" && untracked(view)?.phase !== "end")
        return problem("Дуелът прекъсна", "Без резултат: рейтингът не се променя.", anew);
      if (!k) return h("p", { class: "muted" }, "…");
      if (k === "waiting") return waiting(wait as () => Wait, rematch);
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
          return end(live, v, again);
        case "off":
          return problem("Съперникът не дойде", "Дуелът е без резултат. Потърси нов.", anew);
      }
    },
  );
}

/** Waiting for someone: how long until a recording instead, or, while the game is being updated, that the duel comes
 * right after; for a rematch, how long the other has to ask too. */
function waiting(wait: () => Wait, rematch?: Rematch): Child {
  const left = signal(0);
  effect(() => left.set(Math.ceil(wait().leftMs / 1000)));
  const tick = setInterval(() => left.update((n) => Math.max(0, n - 1)), 1000);
  onCleanup(() => clearInterval(tick));
  return h(
    "div",
    { class: "stack live-wait" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Дуел на живо"),
      h("h1", null, rematch ? "Реванш" : "Търсим съперник"),
      h("p", { class: "lead" }, () =>
        rematch
          ? `Чакаме и ${rematch.name} да поиска реванш.`
          : wait().held
            ? "Играта се обновява. Дуелът започва веднага след това."
            : left() > 0
              ? "Ако никой не дойде до края на броенето, ще играеш срещу запис на истинска игра."
              : "Намираме ти запис на истинска игра…",
      ),
    ),
    () =>
      wait().held
        ? null
        : h(
            "p",
            {
              class: "live-count",
              role: "timer",
              "aria-label": () => `${left()} ${left() === 1 ? "секунда" : "секунди"}`,
            },
            () => String(left()),
          ),
    h("button", { class: "btn", type: "button", onclick: () => goBack("/duel") }, "Откажи"),
  );
}

/** The two, face to face, before the first question, and the seconds to it, big, in a ring: a ping as the other is
 * found, a beep for each of the last seconds. */
function intro(v: LiveView): Child {
  play("ping");
  loadDuelResult().catch(() => {}); // the result's screen, on its way while they play
  const ms = v.startsMs ?? 0;
  const left = signal(Math.max(1, Math.ceil(ms / 1000)));
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
    { class: "stack live-intro" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Дуел на живо"),
      h("h1", null, v.recorded ? "Срещу запис" : "Съперникът е тук"),
      v.recorded
        ? h(
            "p",
            { class: "lead" },
            `Никой не дойде навреме. Играеш срещу запис на истинска игра${v.topic ? ` по тема „${topicName(v.topic)}“` : ""}: всеки отговор идва в мига, в който е даден.`,
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
    readyClock(ms, left),
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

/** What the other is doing on the question now: thinking, answered (and how fast), gone for a moment, or gone (the
 * duel goes on without them). */
function doing(v: LiveView, s: Side): string {
  if (s.gone) return "Излезе от дуела.";
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
  const error = signal("");
  const life = lifetime();
  // An answer that doesn't get through (the line dropped) is sent again while the question is open; one refused for
  // good, not late, frees the options again.
  const open = () => !life.aborted && view().phase === "question" && view().n === first.n;
  const send = async (a: Answer) => {
    locked.set(true);
    error.set("");
    const e = await deliver(`/api/duels/live/${first.id}/answer`, { n: first.n, answer: a }, () => untracked(open));
    if (!e) return sent.set(true);
    error.set(e.message);
    if (e.code !== "not_now" && untracked(open) && left.peek() > 0) {
      if (asked.node instanceof Element)
        for (const b of asked.node.querySelectorAll(".picked")) b.classList.remove("picked");
      locked.set(false);
    }
  };
  const asked = ask(q.view, send, locked);
  // When the time is up, whatever has been put in (a typed number, things moved into order) is the answer.
  const left = countdown(q.leftMs, () => {
    if (locked.peek()) return;
    const pending = asked.pending();
    if (pending) send(pending);
    else locked.set(true);
  });
  effect(() => {
    const v = view();
    if (v.n !== first.n || !v.question || v.phase !== "question") return;
    // More of the question shows as its time runs (the next clue): the server sends it when it's due.
    asked.update?.(v.question.view);
    // The clock goes by the server's.
    const s = Math.ceil(v.question.leftMs / 1000);
    if (Math.abs(s - left.peek()) > 1) left.sync(v.question.leftMs);
  });
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
    verdict(kind, r.points, r.missed ? "Времето изтече." : undefined, r.speed, r.row, r.inRow),
    crowdLine(q.view.type, r.answer.crowd, r.right),
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

/** The result, as the duel was kept (screens/outcome.ts, landing as a moment with its sound): who won, question by
 * question, the rating it moved, what the game earned; then the questions to go over. */
function end(view: () => LiveView, v: LiveView, again: (rematch?: Rematch) => void): Child {
  const kept = signal<DuelView | null>(null);
  const another = (main: boolean) =>
    h("button", { class: main ? "btn primary big" : "btn", type: "button", onclick: () => again() }, "Още един дуел");
  // Against a person: „Реванш“, gold (the other sees it asked, and has a moment to ask too), and another duel beside
  // it; against a recording, another duel.
  const steps = v.recorded
    ? another(true)
    : {
        main: h(
          "div",
          { class: "rematch" },
          () =>
            view().them.rematch
              ? h("p", { class: "rematch-asks", role: "status" }, `${view().them.name} иска реванш.`)
              : null,
          h(
            "button",
            {
              class: "btn primary big",
              type: "button",
              onclick: () => again({ id: v.id, name: v.them.name }),
            },
            "Реванш",
          ),
        ),
        also: [another(false)],
      };
  const error = signal("");
  api<{ duel: DuelView }>("GET", `/api/duels/${v.id}`).then(
    (r) => kept.set(r.duel),
    (err) =>
      error.set(
        (err as ApiError).code === "no_duel"
          ? "Резултатът още се записва. Виж го след малко в дуелите си."
          : errorText(err),
      ),
  );
  return h("div", null, () => {
    const d = kept();
    if (d) return duelResult(d, steps, d.runId ? news(d.runId) : null);
    return error() ? problem("Дуелът свърши", error(), () => again()) : h("p", { class: "muted" }, "…");
  });
}

/** Nobody to play, not even a recording (a game that has just begun): the friends to challenge, each a tap from a duel
 * in their own time; with none, the invite to send; and a topic's game, alone, meanwhile. */
function nobody(again: () => void): Child {
  const mine = signal<{ invite: string; friends: { id: number; name: string }[] } | null>(null);
  api<{ invite: string; friends: { id: number; name: string }[] }>("GET", "/api/friends").then(mine.set, () => {});
  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "intro" },
      h("h1", null, "Точно сега няма с кого"),
      h("p", { class: "lead" }, () =>
        mine()?.friends.length
          ? "Никой не търси дуел, а записи на игри още няма. Предизвикай приятел: играеш сега, а приятелят ти — когато може."
          : "Никой не търси дуел, а записи на игри още няма. Покани приятел или изиграй игра по тема.",
      ),
    ),
    () => {
      const m = mine();
      if (!m) return null;
      if (!m.friends.length)
        return shareButton("Покани приятел", () => "Ела да сме приятели в АЛМАНАХ:", m.invite, true, undefined, true);
      return h(
        "ul",
        { class: "duel-friends" },
        m.friends
          .slice(0, 5)
          .map((f) =>
            h(
              "li",
              null,
              h("strong", null, f.name),
              h(
                "button",
                { class: "btn inline", type: "button", onclick: () => go(`/challenge/${f.id}`) },
                "Предизвикай",
              ),
            ),
          ),
      );
    },
    h(
      "div",
      { class: "result-actions" },
      h("a", { class: "btn", href: "/play/all" }, "Играй по тема"),
      h("button", { class: "btn", type: "button", onclick: again }, "Опитай пак"),
    ),
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
