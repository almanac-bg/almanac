// Роял: at 21:00, live, Friday to Sunday (every evening once those fill). Up to fifty players on the same fifteen
// questions at the same moment, easy to hard in three rounds. A wrong answer puts nobody out: after questions 5, 8, 11
// and 14 those with the most right go on (of as many, the quicker), and the last question is a final of three; those
// cut play on to the end for themselves, off the standings (each right answer still earns its XP). Each answer shows
// with the standings and the next cut's line; the answer a cut comes with shows it as a card (gold for those who go
// on, plain for those it puts out), its line drawn into the standings, and the time where it tells players apart.
// The lobby opens a quarter of an hour before, with the friends who said they'd come; whoever is on this screen at
// the start plays, and those who come late may still come in until the third question's answer shows. The screen is
// kept on in the lobby and the game.
//
// The server sends the evening as this player sees it after every change; the browser reconnects if the line drops.
// It loads on its own, the first time it's opened, and is handed the app's pieces (kit.ts).

import type { Answer, Reveal, Reviewed, View } from "../game/types.ts";
import type { Kit } from "../kit.ts";
import type { ApiError } from "../lib/api.ts";
import type { Child, Signal } from "../lib/dom.ts";
import type { Tier, VerdictKind } from "../ui.ts";
import type { Standing } from "./duel.ts";
import type { Tonight } from "./modes.ts";

// The app's pieces, set as the screen opens (royal): it loads on its own, the first time it's opened (kit.ts), and
// imports only types.
let {
  answered,
  ask,
  crowdLine,
  picture,
  review,
  questionHead,
  timer,
  upNext,
  api,
  keepAwake,
  computed,
  effect,
  h,
  onCleanup,
  signal,
  untracked,
  ordinal,
  place,
  pushable,
  pushOn,
  turnOn,
  title,
  play,
  playAnswer,
  playCount,
  categories,
  player,
  playing,
  user,
  avatar,
  back,
  pageArt,
  verdict,
  who,
  standingCard,
  clock,
  coming,
  when,
} = {} as Kit;

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
  /** Every evening (else Friday to Sunday). */
  nightly?: boolean;
  /** In this tournament (its lobby, or its game); cut out of its standings (they play on). */
  in: boolean;
  out: boolean;
  /** The viewer's right answers in all, those after a cut too. */
  rights?: number;
  /** Not in, but may still come in: the games have begun, and the door is open until the third question's answer. */
  late?: boolean;
  tables: number;
  n: number;
  entered: number;
  left: number;
  /** How many went out on the answer showing (a cut). */
  wentOut: number;
  /** The next cut: the one the answer showing comes with, while it shows (none in the final). */
  cut?: Cut;
  /** The game ends once the answer showing has shown: the standings come next. */
  last?: boolean;
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

/** A cut of the game: after which question, how many go on, and the line (the last who'd go on, as it stands). */
interface Cut {
  after: number;
  keep: number;
  line?: Score;
  /** It's the answer showing that the cut comes with; then, the cut after it (none: the final's next). */
  now?: boolean;
  then?: number;
}

interface Score {
  rights: number;
  ms: number;
}

interface Player {
  key: number;
  name: string;
  tag: string;
  in: boolean;
  /** Right answers so far, and the time they took (which tells apart those with as many). */
  reached: number;
  ms: number;
  /** Where they stand now (those level share it). */
  rank: number;
  /** They'd go on at the next cut as they stand (or have, at the cut showing). */
  goes?: boolean;
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

/** Time left in the last hour, as a clock (12:05). */
function left(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const rights = (n: number) => `${n} ${n === 1 ? "верен" : "верни"}`;

/** How far a player got, in words: how many right. */
function reach(p: Player | Past["players"][number], length: number): string {
  if (p.reached >= length) return `всичките ${length}!`;
  return rights(p.reached);
}

/** Seconds, to a tenth: „41,3 с“. */
const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} с`;

/** A score in words: „4 верни, 41,3 с“. */
const scored = (s: Score) => `${rights(s.rights)}, ${seconds(s.ms)}`;

/** „8-ия въпрос“. */
const nth = (n: number) => `${ordinal(n)}я въпрос`;

const signed = (d: number) => `${d > 0 ? "+" : ""}${d}`;
const delta = (d?: number) => (d ? h("span", { class: d > 0 ? "delta up" : "delta down" }, signed(d)) : null);

export function royal(kit: Kit) {
  ({
    answered,
    ask,
    crowdLine,
    picture,
    review,
    questionHead,
    timer,
    upNext,
    api,
    keepAwake,
    computed,
    effect,
    h,
    onCleanup,
    signal,
    untracked,
    ordinal,
    place,
    pushable,
    pushOn,
    turnOn,
    title,
    play,
    playAnswer,
    playCount,
    categories,
    player,
    playing,
    user,
    avatar,
    back,
    pageArt,
    verdict,
    who,
    standingCard,
    clock,
    coming,
    when,
  } = kit);
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
  // The screen stays on while the evening needs it: in the lobby, once in, and through the game.
  keepAwake(() => {
    const v = view();
    return !!v && (v.phase === "question" || v.phase === "reveal" || (v.phase === "lobby" && v.in));
  });

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
          return [door(live, joined), question(live, v)];
        case "reveal":
          return [door(live, joined), reveal(live, v)];
        case "end":
          return end(live, v, now);
      }
    },
  );
}

const about = (nightly?: boolean) =>
  `${nightly ? "Всяка вечер" : "Петък, събота и неделя"} в 21:00: до 50 души, 15 въпроса, в един и същи миг. Грешката не те изважда: след 5-ия, 8-ия, 11-ия и 14-ия въпрос продължават тези с повече верни, а при равни — по-бързите. Последния въпрос играят трима.`;

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
      h("p", { class: "lead" }, () => about(view().nightly)),
    ),
    h(
      "section",
      { class: "card royal-next" },
      h("p", { class: "kicker" }, "Следващият Роял"),
      h("strong", { class: "royal-when" }, () => when(view().startsAt, now())),
      h("p", { class: "muted" }, () => {
        // When; a countdown too in the last hour.
        const ms = view().opensAt - now();
        return `Входът се отваря ${when(view().opensAt, now())}${ms < 3600_000 ? `, след ${left(ms)}` : ""}.`;
      }),
      plan(),
    ),
    () => {
      const d = past();
      // The division once a game has moved the rating (play/unfold.go).
      return d ? [d.standing.rated ? standingCard(d.standing, true) : null, history(d.royals)] : null;
    },
  );
}

/** „Ще дойда“: saying you'll come to the next evening, and how many have (before the lobby opens, and under an evening's
 * standings). Those who said so are called as its lobby opens, if notifications are on here. */
function plan(): Child {
  const tonight = signal<Tonight | null>(null);
  const notified = signal<boolean | null>(null);
  const busy = signal(false);
  const error = signal("");
  // Again now and then: the screen may stay while the evening moves on (its standings show for a while).
  const load = () => api<Tonight>("GET", "/api/royal/tonight").then(tonight.set, () => {});
  load();
  const again = setInterval(load, 20_000);
  onCleanup(() => clearInterval(again));
  pushOn().then(notified.set, () => notified.set(false));
  const run = async (fn: () => Promise<void>) => {
    error.set("");
    busy.set(true);
    try {
      await fn();
    } catch (err) {
      error.set((err as ApiError).message);
    } finally {
      busy.set(false);
    }
  };
  const say = (come: boolean) =>
    run(async () => {
      await player();
      tonight.set(await api<Tonight>(come ? "POST" : "DELETE", "/api/royal/plan", come ? {} : undefined));
    });
  const call = () =>
    run(async () => {
      const why = await turnOn();
      if (why) error.set(why);
      else notified.set(true);
    });
  return h(
    "div",
    { class: "royal-plan" },
    () => {
      const t = tonight();
      if (!t || t.glance.phase === "lobby") return null;
      const opensAt = t.glance.next - (t.glance.startsAt - t.glance.opensAt);
      const opens = clock(opensAt);
      return [
        t.coming > 0 ? h("p", { class: "royal-coming" }, `${coming(t)}.`) : null,
        t.planned
          ? [
              h(
                "p",
                null,
                notified()
                  ? `Ще дойдеш. Ще ти напомним ${when(opensAt, t.glance.now)}.`
                  : "Ще дойдеш. Ела тук, щом входът се отвори.",
              ),
              h(
                "div",
                { class: "actions" },
                notified() === false && pushable()
                  ? h("button", { class: "btn", disabled: busy, onclick: call }, `Напомни ми в ${opens}`)
                  : null,
                h("button", { class: "link", disabled: busy, onclick: () => say(false) }, "Няма да успея"),
              ),
            ]
          : h("button", { class: "btn", disabled: busy, onclick: () => say(true) }, "Ще дойда"),
      ];
    },
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

/** The last evenings you played. */
function history(list: Past[]): Child {
  if (!list.length) return null;
  return h(
    "section",
    { class: "stack" },
    h("h2", { class: "section-title" }, "Последните ти вечери"),
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

/** The lobby's players as chips with their avatars (dimmer: not on the screen). */
function chips(players: Player[]): Child {
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
      ),
    ),
  );
}

/** The way in (and, from the lobby, out): its button, and what went wrong. */
function entry(joined: () => void, out?: boolean): Child[] {
  const error = signal("");
  const busy = signal(false);
  const act = async () => {
    error.set("");
    busy.set(true);
    try {
      await player();
      await api(out ? "DELETE" : "POST", "/api/royal", out ? undefined : {});
      joined();
    } catch (err) {
      error.set((err as ApiError).message);
    } finally {
      busy.set(false);
    }
  };
  return [
    h(
      "button",
      { class: out ? "btn" : "btn primary big", type: "button", disabled: busy, onclick: act },
      out ? "Излез" : "Влез",
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  ];
}

function lobby(view: () => Evening, now: Signal<number>, joined: () => void): Child {
  const v0 = view();
  // Those whose notifications are on here are called a minute before the start, if their screen is away.
  const notified = signal(false);
  if (v0.in) pushOn().then(notified.set, () => {});
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
      h("p", { class: "lead" }, () =>
        v0.in
          ? notified()
            ? "Вътре си. Ако излезеш от екрана, ще ти напомним минута преди началото."
            : `Вътре си. Остани на този екран до ${clock(v0.startsAt)}.`
          : `В ${clock(v0.startsAt)} всички получават първия въпрос едновременно. Закъснелите влизат до 3-тия въпрос.`,
      ),
    ),
    entry(joined, v0.in),
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

/** The door, for one not in once the games have begun: still open until the third question's answer shows. */
function door(view: () => Evening, joined: () => void): Child {
  return () =>
    view().late && !view().in
      ? h(
          "section",
          { class: "card stack" },
          h("p", null, "Роял вече започна. До 3-тия въпрос още можеш да влезеш."),
          entry(joined),
        )
      : null;
}

/** Which question, of which round, and its topic. */
function head(v: Evening): Child {
  const round = Math.floor(v.n / v.round) + 1;
  return questionHead(v.n, v.length, `Кръг ${round} · ${topicName(v.question?.category ?? "")}`);
}

/** Where the game stands for this player: how many are in, their place and score, and the next cut with its line
 * (as of the last answer shown). */
function standing(view: () => Evening): Child {
  return h("div", { class: "royal-standing", role: "status" }, () => {
    const v = view();
    if (v.entered === 1) {
      return h(
        "p",
        { class: "royal-left" },
        v.in ? "В турнира си само ти: играеш и петнадесетте въпроса." : "В този турнир играе само един.",
      );
    }
    const me = v.players.find((p) => p.me);
    const c = v.cut;
    const where = !me
      ? null
      : !me.in
        ? `Извън класирането: отпадна след ${nth(me.outAt + 1)}.`
        : `Ти си ${ordinal(me.rank)}: ${rights(me.reached)}, ${seconds(me.ms)}.`;
    let line: string;
    if (!c) line = "Финал: печели този с най-много верни, а при равни — по-бързият.";
    else if (c.now) line = "";
    else if (!c.line) line = `След ${nth(c.after)} продължават първите ${c.keep}: засега всички.`;
    else
      line = `След ${nth(c.after)} продължават първите ${c.keep}. Чертата: ${scored(c.line)}${
        me?.in ? (me.goes ? " — засега продължаваш." : " — под нея си.") : ""
      }`;
    return [
      h("p", { class: "royal-left" }, `В играта: ${v.left} от ${v.entered}`),
      where ? h("p", { class: "royal-me" }, where) : null,
      line ? h("p", { class: "royal-line" }, line) : null,
    ];
  });
}

/** What a cut did, as its answer shows: a card for the one it lets through or puts out, a line for the others. */
function cutSaid(v: Evening): Child {
  const c = v.cut;
  if (!c?.now || v.entered === 1) return null;
  const me = v.players.find((p) => p.me);
  const card = (through: boolean, head: string, line: string) => {
    // The cut sounds a moment after the answer's own sound: through, or out.
    setTimeout(() => play(through ? "through" : "out"), 500);
    return h(
      "section",
      { class: through ? "card royal-cut through" : "card royal-cut", role: "status" },
      h("b", null, head),
      h("p", null, line),
    );
  };
  if (me?.in)
    return card(
      true,
      "Продължаваш!",
      `Още ${v.left} в играта · ${c.then ? `следващото отсяване след ${nth(c.then)}` : "следва финалът"}`,
    );
  if (me?.outAt === v.n)
    return card(
      false,
      `Отпадаш след ${nth(v.n + 1)}.`,
      "Вече си извън класирането. Играй до края за себе си: всеки верен отговор носи XP.",
    );
  return h(
    "p",
    { class: "royal-line", role: "status" },
    `Отсяване: продължават ${v.wentOut ? `${v.left} от ${v.left + v.wentOut}` : "всички"}.`,
  );
}

/** The time a player's right answers took, under them, where it tells them from a neighbour with as many (5 верни,
 * 41,2 с); none where it doesn't. */
function timed(p: Player, ps: Player[], i: number): Child {
  const level = (o?: Player) => o && o.outAt === p.outAt && o.reached === p.reached;
  return level(ps[i - 1]) || level(ps[i + 1]) ? h("span", { class: "muted" }, seconds(p.ms)) : null;
}

/** The standings as the answer showing leaves them: those who go on (or would, at the next cut) marked, the line
 * between, and those out below. */
function standings(v: Evening): Child {
  const c = v.cut;
  const rows: Child[] = [];
  v.players.forEach((p, i, all) => {
    rows.push(
      h(
        "li",
        {
          class: ["row", p.goes && "up", !p.in && "out", p.me && "me"].filter(Boolean).join(" "),
        },
        h("span", { class: "place" }, String(p.rank)),
        who(p.name, p, p.me ? h("span", { class: "you" }, "ти") : null, p.name, p.tag),
        h(
          "span",
          { class: "royal-reach" },
          h("span", null, rights(p.reached)),
          timed(p, all, i),
          p.in ? null : h("span", { class: "muted" }, `до ${ordinal(p.outAt + 1)}я`),
        ),
      ),
    );
    const next = all[i + 1];
    if (c && p.goes && next && !next.goes) {
      // The cut's own line is drawn as its answer shows.
      rows.push(
        h(
          "li",
          { class: c.now ? "league-line up now" : "league-line up" },
          c.now ? "Продължават" : `Дотук продължават след ${nth(c.after)}`,
        ),
      );
    }
  });
  return h("section", { class: "board league-board royal-table" }, h("h2", null, "Класиране"), h("ol", null, rows));
}

function question(view: () => Evening, first: Evening): Child {
  const q = first.question;
  if (!q) return null;
  if (first.n === 0 && first.in) play("go"); // the game starts
  // Those cut play on, off the standings.
  const plays = first.in;
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
  // More of the question shows as its time runs (the next clue): the server sends it when it's due.
  effect(() => {
    const v = view();
    if (v.n === first.n && v.question) asked.update?.(v.question.view);
  });
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
    picture(q.view, true),
    asked.node,
    () => {
      const v = view();
      // The answer waits for those still in.
      const waiting = v.players.filter((p) => p.in);
      const done = waiting.filter((p) => p.answered).length;
      return h(
        "p",
        { class: "status", role: "status" },
        !plays ? "Гледаш. " : v.out ? "Извън класирането. " : "",
        sent() ? "Отговорът ти е приет. " : "",
        `Отговориха ${done} от ${waiting.length}.`,
      );
    },
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
    standing(view),
  );
}

function reveal(view: () => Evening, first: Evening): Child {
  const q = first.question;
  const r = q?.reveal;
  if (!q || !r) return null;
  const kind: VerdictKind = r.missed ? "time" : r.exact ? "exact" : r.right ? "right" : "wrong";
  if (r.mine) playAnswer(kind, r.right ? 1 : 0);
  return h(
    "article",
    { class: "question" },
    head(first),
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view, true),
    answered(q.view, r.answer, r.mine ? (q.given ?? null) : null),
    r.mine ? verdict(kind, r.points, r.missed ? "Без отговор" : undefined, r.speed) : null,
    crowdLine(q.view.type, r.answer.crowd, r.mine && r.right),
    cutSaid(first),
    standing(view),
    upNext(q.nextMs ?? 0, first.last ? "Към класирането…" : `Въпрос ${first.n + 2} след малко…`),
    standings(first),
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
            me.outAt >= 0
              ? // Cut, they played on: all their right answers, those after the cut too.
                `Общо: ${first.rights ?? me.reached} от ${first.length} верни.`
              : me.reached >= first.length
                ? `Всичките ${first.length} верни.`
                : `${me.reached} от ${first.n + 1} верни.`,
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
        first.players.map((p, i, all) =>
          h(
            "li",
            { class: ["row", (p.place ?? 9) <= 3 && `p${p.place}`, p.me && "me"].filter(Boolean).join(" ") },
            h("span", { class: "place" }, String(p.place ?? "")),
            who(p.name, p, p.me ? h("span", { class: "you" }, "ти") : null, p.name, p.tag),
            h(
              "span",
              { class: "royal-reach" },
              h("span", { class: "muted" }, reach(p, first.length)),
              timed(p, all, i),
              delta(p.delta),
            ),
          ),
        ),
      ),
    ),
    h("p", { class: "muted" }, () => `Следващият Роял: ${when(view().next, now())}.`),
    plan(),
    first.runId
      ? review(async () => (await api<{ questions: Reviewed[] }>("GET", `/api/runs/${first.runId}/review`)).questions)
      : null,
  );
}
