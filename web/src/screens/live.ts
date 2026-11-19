// A live duel: waiting for someone (or, after 10 seconds, a recording of a real game), the two face to face, then
// each question for both at the same moment — the other's answer comes in as they give it, and shows with yours (the
// other gone for good while the player leads, the win is theirs to take at once) — and the result, its rematch kept in
// sight. The server sends the duel as this player sees it after every change; the line, should it drop, is
// opened again (lib/stream.ts), and comes back to the same duel. Each question is answered as in every game
// (game/answering.ts).
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
  answering,
  api,
  avatar,
  byTap,
  computed,
  crowdLine,
  effect,
  errorText,
  duelResult,
  emblem,
  formatNumber,
  go,
  goBack,
  guardLeaving,
  holdWhile,
  h,
  keepAwake,
  lifetime,
  loadDuelResult,
  nameFirst,
  news,
  onCleanup,
  onScreen,
  picture,
  play,
  playAnswer,
  playCount,
  playingWhile,
  questionHead,
  readyClock,
  shareButton,
  signal,
  startScreen,
  staying,
  stream,
  timer,
  title,
  topics,
  trail,
  untracked,
  upNext,
  verdict,
  when,
} = {} as Kit;

interface Side {
  name: string;
  tag?: string;
  avatar?: string;
  title?: string;
  titleTier?: Tier;
  level?: number;
  rating: number;
  /** Their division; "" while their rating is still being set (play/rating.go). */
  division: "bronze" | "silver" | "gold" | "platinum" | "diamond" | "legend" | "";
  points: number;
  rights: number;
  trail: Mark[];
  online: boolean;
  /** Away longer than the duel waits: it goes on without them. */
  gone?: boolean;
  answered: boolean;
  /** Asks for a rematch, the duel over: the other has a moment to ask too. */
  rematch?: boolean;
  /** How long the player still has to ask too. */
  rematchMs?: number;
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
const divisionNames: Record<Exclude<Side["division"], "">, string> = {
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
    answering,
    api,
    avatar,
    byTap,
    computed,
    crowdLine,
    effect,
    errorText,
    duelResult,
    emblem,
    formatNumber,
    go,
    goBack,
    guardLeaving,
    holdWhile,
    h,
    keepAwake,
    lifetime,
    loadDuelResult,
    nameFirst,
    news,
    onCleanup,
    onScreen,
    picture,
    play,
    playAnswer,
    playCount,
    playingWhile,
    questionHead,
    readyClock,
    shareButton,
    signal,
    startScreen,
    staying,
    stream,
    timer,
    title,
    topics,
    trail,
    untracked,
    upNext,
    verdict,
    when,
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
  // The other gone and the player ahead, they chose to play on rather than take the win: not asked again (claim).
  const playOn = signal(false);

  // Over, the result stays: a stream that ends then (the duel forgotten) or drops doesn't take it away.
  const over = () => view.peek()?.phase === "end";
  // The screen gone before the player was made (a first-time guest) and named: no stream, which would join the queue.
  const life = lifetime();
  // Waiting for an opponent, a reload of the page (a new version of the game: fresh.ts) would lose the place in the
  // queue: it waits for the next screen.
  staying(() => !!wait.peek() && !view.peek());
  // A first duel asks for a name of the player's own first, if they still have the one drawn for them (name.ts): the
  // other side sees it. Only before a new search: never over a clock running, on coming back to a duel under way (a
  // reload, „Върни се“, another device: the ask is per device), nor for a rematch.
  const underWay = () =>
    api<{ playing: { kind: string } | null }>("GET", "/api/playing").then(
      (p) => p.playing?.kind === "duel",
      () => false,
    );
  (rematch ? Promise.resolve(true) : nameFirst(underWay))
    .then((on) => {
      if (!on || life.aborted) return;
      const ends = (event: Exclude<Trouble, "" | "reconnecting">) => () => {
        line.close();
        if (!over()) trouble.set(event);
      };
      const line = stream(`/api/duels/live/events${rematch ? `?rematch=${rematch.id}` : ""}`, {
        life,
        on: {
          waiting: (data) => {
            trouble.set("");
            // A line that dropped while waiting starts the wait again; a duel that ended doesn't come back.
            if (view.peek()) return line.close();
            wait.set(JSON.parse(data));
          },
          message: (data) => {
            trouble.set("");
            const v: LiveView = JSON.parse(data);
            view.set(v);
            // Over, it's still followed for a while: the other may ask for a rematch.
            if (v.phase === "off") line.close();
          },
          closed: ends("closed"),
          nobody: ends("nobody"),
          busy: ends("busy"),
          norematch: ends("norematch"),
          paused: ends("paused"),
        },
        down: (down) => {
          if (!down) return;
          if (over()) line.close();
          else trouble.set("reconnecting");
        },
      });
    })
    .catch(() => trouble.set("busy"));
  // Under way from the first question to the result.
  const costs = () => {
    const phase = view()?.phase;
    return phase === "question" || phase === "reveal";
  };
  playingWhile(costs);
  // Leaving mid-duel costs it (live.go): the duel goes on without the player, their time running out on each question,
  // and its result counts. Every way out asks first; a leave confirmed is told the server at once, so that the other
  // isn't kept waiting for this player's line to drop (it goes all the same if that can't be said). A duel opened from
  // outside (a link, a notification) has an entry of its own meanwhile (holdWhile), so that back asks too.
  holdWhile(costs);
  const leaveAsk = guardLeaving(
    "Излизаш от дуела? Той продължава без теб: въпросите остават без отговор, а резултатът се брои.",
    costs,
    async (on) => {
      const id = view.peek()?.id;
      if (id) await api("POST", `/api/duels/live/${id}/leave`).catch(() => {});
      on();
    },
  );
  // The screen stays on from the wait for an opponent to the result: a phone asleep drops the duel.
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
      const offer = () => claim(live, playOn, () => playOn.set(true));
      switch (v.phase) {
        case "intro":
          return intro(v);
        case "question":
          scrollTo(0, 0); // each question opens at the top, wherever the answer before it was scrolled to
          return question(live, v, offer);
        case "reveal":
          return reveal(live, v, offer);
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
              ? "Търсим някого близо до твоя рейтинг. Ако никой не дойде до края на броенето, играеш срещу запис на истинска игра."
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
      { class: s.division ? `live-face d-${s.division}` : "live-face" },
      avatar(s.avatar, { size: "l", level: s.level, name: s.name }),
      h("strong", { class: "live-name" }, s.name),
      h("span", { class: "kicker" }, label),
      h(
        "span",
        { class: "live-division" },
        s.division
          ? [emblem(s.division, "s"), `${divisionNames[s.division]} · ${s.rating}`]
          : `Рейтинг ${s.rating} · още се определя`,
      ),
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

/** Both sides at a glance, face to face in one card (the player's on the left, the other's mirrored on the right):
 * points, the leader's in gold, how each answer went (two rows of five, big enough to read; on a phone only once an
 * answer shows, so that the question has the screen while its time runs), and how the other is doing on this one. */
function scoreboard(view: () => LiveView, total: number): Child {
  const ahead = (mine: boolean) => {
    const { you, them } = view();
    return mine ? you.points > them.points : them.points > you.points;
  };
  const side = (s: () => Side, mine: boolean) =>
    h(
      "div",
      { class: () => ["live-side", mine ? "me" : "them", ahead(mine) && "ahead"].filter(Boolean).join(" ") },
      h(
        "div",
        { class: "live-who" },
        () => avatar(s().avatar, { size: "s", name: s().name }),
        h(
          "span",
          { class: "live-who-text" },
          h("span", { class: "live-side-name" }, () => (mine ? "Ти" : s().name)),
          h("b", { class: "live-points" }, () => formatNumber(s().points)),
        ),
      ),
      () => trail(s().trail, total, view().phase === "question" ? view().n : -1),
      mine ? null : () => h("p", { class: "live-doing", role: "status" }, doing(view(), s())),
    );
  return h(
    "section",
    { class: () => `live-board ${view().phase}`, "aria-label": "Резултат" },
    side(() => view().you, true),
    side(() => view().them, false),
  );
}

/** The other gone for good while the player leads (live.go, Claim): the win is theirs to take now, the questions left
 * unanswered by both (and so no XP for them), or to play on for it. Told once it's so, until a choice is made; gone
 * again if the other comes back, or the lead goes. */
function claim(view: () => LiveView, dismissed: () => boolean, dismiss: () => void): Child {
  const busy = signal(false);
  const error = signal("");
  const take = async () => {
    busy.set(true);
    error.set("");
    try {
      await api("POST", `/api/duels/live/${view().id}/claim`);
      // The duel's end comes with its next view, at once.
    } catch {
      error.set("Не стана: дуелът продължава.");
      busy.set(false);
    }
  };
  return () => {
    const v = view();
    const can = !dismissed() && v.them.gone && v.you.points > v.them.points;
    if (!can) return null;
    return h(
      "section",
      { class: "card live-claim" },
      h(
        "p",
        { class: "live-claim-line", role: "status" },
        h("strong", null, `${v.them.name} излезе.`),
        " Победата е твоя.",
      ),
      h(
        "div",
        { class: "live-claim-actions" },
        h("button", { class: "btn primary", type: "button", disabled: busy, onclick: take }, "Вземи победата"),
        h("button", { class: "btn", type: "button", disabled: busy, onclick: dismiss }, "Изиграй докрай"),
      ),
      () => (error() ? h("p", { class: "bad", role: "alert" }, error()) : null),
    );
  };
}

/** What the other is doing on the question now: thinking, answered (and how fast), gone for a moment, or gone (the
 * duel goes on without them). A recording shows who played it (play/recordings.go), so it says it's one whenever it
 * hasn't an answer to show: never „Мисли…“, as if they were here now. */
function doing(v: LiveView, s: Side): string {
  if (s.gone) return "Излезе от дуела.";
  if (v.phase === "question" && s.answered) return `Отговори за ${seconds(s.tookMs ?? 0)}`;
  if (v.recorded) return "Запис";
  if (v.phase !== "question") return "";
  if (!s.online) return "Връзката на съперника прекъсна…";
  return "Мисли…";
}

function question(view: () => LiveView, first: LiveView, offer: () => Child): Child {
  const q = first.question;
  if (!q) return null;
  if (first.n === 0) play("go"); // the game starts
  // The player's time runs from when this screen shows it, its pictures in (onScreen).
  return h(
    "article",
    { class: "question" },
    questionHead(first.n, first.total, topicName(q.category)),
    scoreboard(view, first.total),
    offer(),
    onScreen(
      q.view,
      () => asking(view, first),
      () => api("POST", `/api/duels/live/${first.id}/seen`, { n: first.n }),
    ),
  );
}

/** The question itself, once it's on the screen: its clock, the question, its options, and how the answer goes. */
function asking(view: () => LiveView, first: LiveView): Child {
  // Its time left as the server last said, from when this screen shows it.
  const now = untracked(view);
  const q = (now.n === first.n && now.phase === "question" ? now.question : null) ?? first.question;
  if (!q) return null;
  const life = lifetime();
  // Answered as in every game (game/answering.ts): sent again while it doesn't get through and the question is open;
  // in once the server says so, or its view has it.
  const ans = answering({
    view: q.view,
    leftMs: q.leftMs,
    post: (answer) => api("POST", `/api/duels/live/${first.id}/answer`, { n: first.n, answer }),
    open: () => !life.aborted && view().phase === "question" && view().n === first.n,
    inView: () => view().n === first.n && !!view().question?.given,
  });
  // More of the question shows as its time runs (the next clue), and the clock goes by the server's.
  effect(() => {
    const v = view();
    if (v.n === first.n && v.question && v.phase === "question") ans.follow(v.question.view, v.question.leftMs);
  });
  // The other answering is news while the player still thinks: a sound of its own (feel.ts: them), not a tap the
  // player might take for theirs. Once they've answered, the other's answer brings both answers at once: it would
  // sound over the player's own verdict.
  let heard = now.them.answered;
  effect(() => {
    if (view().them.answered && !heard) {
      heard = true;
      if (!untracked(ans.taken)) play("them");
    }
  });
  return [
    timer(q.leftMs, q.limitMs, ans.left, ans.stopped),
    ans.heading,
    picture(q.view, true),
    ans.asked.node,
    () =>
      ans.taken()
        ? h(
            "p",
            { class: "status", role: "status" },
            view().them.answered ? "Отговорите идват…" : `Отговорът ти е приет. Чакаме ${view().them.name}.`,
          )
        : null,
    ans.said,
  ];
}

function reveal(view: () => LiveView, first: LiveView, offer: () => Child): Child {
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
    offer(),
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view, true),
    answered(q.view, r.answer, q.given ?? null),
    verdict(kind, r.points, r.missed ? "Времето изтече." : undefined, r.speed, r.inRow),
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
  // Against a person: „Реванш“, gold and docked at the screen's foot (the other sees it asked, and has a moment to ask
  // too), and another duel beside it; against a recording, another duel. The other asking shows over it, with the
  // seconds they wait, and a ping. Once the other has left the result (and doesn't ask: one who asks waits on another
  // screen), a rematch can't come about: another duel is the gold way then. A line that drops a moment isn't leaving.
  const there = signal(true);
  let gone = 0;
  effect(() => {
    const them = view().them;
    clearTimeout(gone);
    if (them.online || them.rematch) there.set(true);
    else gone = window.setTimeout(() => there.set(false), 2000);
  });
  onCleanup(() => clearTimeout(gone));
  const asks = computed(() => !!view().them.rematch);
  effect(() => {
    if (asks()) play("ping");
  });
  const rematchStep = h(
    "div",
    { class: "rematch" },
    when(asks, () => {
      const them = view().them;
      return h(
        "p",
        { class: "rematch-asks", role: "status" },
        rematchClock(them.rematchMs ?? 0),
        h("span", null, `${them.name} иска реванш`),
      );
    }),
    h(
      "button",
      {
        class: "btn primary big",
        type: "button",
        onclick: () => again({ id: v.id, name: v.them.name }),
      },
      () => (asks() ? "Да, реванш" : "Реванш"),
    ),
  );
  const steps = v.recorded
    ? another(true)
    : {
        main: () => (there() ? rematchStep : another(true)),
        also: [() => (there() ? another(false) : null)],
        dock: true,
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

/** How long the other still waits for the player's yes to a rematch (live.RematchFor in all): the seconds, in a ring
 * that drains. */
function rematchClock(ms: number): Child {
  const all = 15_000;
  const left = signal(Math.max(0, Math.ceil(ms / 1000)));
  const tick = setInterval(() => left.update((n) => Math.max(0, n - 1)), 1000);
  onCleanup(() => clearInterval(tick));
  const ns = "http://www.w3.org/2000/svg";
  const ring = document.createElementNS(ns, "svg");
  ring.setAttribute("viewBox", "0 0 40 40");
  ring.setAttribute("class", "rematch-ring");
  ring.setAttribute("aria-hidden", "true");
  const circle = (cls: string) => {
    const c = document.createElementNS(ns, "circle");
    for (const [k, val] of Object.entries({ class: cls, cx: "20", cy: "20", r: "17", pathLength: "100" }))
      c.setAttribute(k, val);
    ring.append(c);
    return c;
  };
  circle("rematch-track");
  circle("rematch-arc").animate(
    [{ strokeDashoffset: String(100 * (1 - Math.min(ms, all) / all)) }, { strokeDashoffset: "100" }],
    { duration: Math.max(0, ms), easing: "linear", fill: "forwards" },
  );
  return h(
    "span",
    { class: "rematch-clock", role: "timer", "aria-label": () => `${left()} ${left() === 1 ? "секунда" : "секунди"}` },
    ring,
    h("b", { class: "num" }, () => String(left())),
  );
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
      h("a", { class: "btn", href: "/" }, "Към Начало"),
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
