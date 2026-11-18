// Роял: at 21:00, live, Friday to Sunday (every evening once those fill). Up to fifty players on the same fifteen
// questions at the same moment, easy to hard in three rounds. A wrong answer puts nobody out: after questions 5, 8, 11
// and 14 those with the most right go on (of as many, the quicker), and the last question is a final of three; those
// cut play on to the end for themselves, off the standings (each right answer still earns its XP). Each answer shows
// with the standings and the next cut's line; the answer a cut comes with shows it as a card (gold for those who go
// on, plain for those it puts out), its line drawn into the standings, and the time where it tells players apart.
// The lobby opens a quarter of an hour before, with the friends who said they'd come; whoever is on this screen at
// the start plays, and those who come late may still come in until the third question's answer shows. The screen is
// kept on in the lobby and the game. The lobby tells one who hasn't played a Роял how it's played, in a line, and what
// two or three in it make of the cuts; the end leads on to the day's ten if they wait, else to the next evening.
//
// Those in hear a quiet bed of music while they wait in the lobby (feel.ts: the game's only music), after a touch has
// started the sound, with „Звуци“ and „Музика в Роял“ on; it rises in the last ten seconds, and the first question
// ends it with the motif's first two notes.
//
// The server sends the evening as this player sees it after every change; the line, should it drop, is opened again
// (lib/stream.ts), and a screen too many for the server is told so and comes back in a while. Each question is
// answered as in every game (game/answering.ts): an answer that doesn't get through is sent again while its question
// is open, the same answer as the server shows the question again after a restart (drawn anew). It loads on its own,
// the first time it's opened, and is handed the app's pieces (kit.ts).

import type { Bed } from "../feel.ts";
import type { AnswerState } from "../game/answering.ts";
import type { Answer, Reveal, Reviewed, View } from "../game/types.ts";
import type { Kit } from "../kit.ts";
import type { Child, Signal } from "../lib/dom.ts";
import type { Standing, Tier, VerdictKind } from "../ui.ts";
import type { Tonight } from "./modes.ts";

// The app's pieces, set as the screen opens (royal): it loads on its own, the first time it's opened (kit.ts), and
// imports only types.
let {
  answered,
  answering,
  answerState,
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
  liveAudio,
  musicOn,
  soundOn,
  categories,
  player,
  playingWhile,
  user,
  avatar,
  back,
  guardLeaving,
  pageArt,
  verdict,
  stream,
  who,
  standingCard,
  clock,
  coming,
  dayWord,
  when,
  whileSeen,
  errorText,
  lifetime,
} = {} as Kit;

type Phase = "soon" | "lobby" | "question" | "reveal" | "end";

/** The evening as this screen sees it: its tournament's board (the same for everyone following it) with the player's
 * own part, in one (royal.Board and royal.Own). */
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
  /** How many are still in; in the lobby, how many are in it. */
  left: number;
  /** How many went out on the answer showing (a cut). */
  wentOut: number;
  /** How many have answered the question showing, of how many play it (those cut too). */
  answered: number;
  playing: number;
  /** The next cut: the one the answer showing comes with, while it shows (none in the final). */
  cut?: Cut;
  /** The game ends once the answer showing has shown: the standings come next. */
  last?: boolean;
  /** In the lobby, its first few; with an answer and at the end, everyone, in their order; none during a question. */
  players: Player[];
  /** The player, as the board would show them (it may not: the lobby shows a few, a question nobody). */
  me?: Player;
  question?: {
    category: string;
    view: View;
    limitMs: number;
    /** When it showed (the server's clock): later, if it showed again after a restart of the server. */
    shown?: number;
    reveal?: { answer: Reveal };
  };
  /** How long the question has left, and, while its answer shows, how long until the game moves on. */
  leftMs: number;
  nextMs?: number;
  /** The player's answer, once given, and how it went, once the answer shows (if they were in for it). */
  given?: Answer;
  mine?: { points: number; speed?: number; right: boolean; exact?: boolean; missed?: boolean };
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
  /** On the screen (in the lobby). */
  online?: boolean;
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

/** Time left in the last hour, with its unit, so that it never reads as hours: „20 с“ in the last minute; before it,
 * whole minutes („3 мин“), or to the second (`ticking`: „2:05 мин“) where the count runs before the player's eyes. */
function left(ms: number, ticking = false): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} с`;
  return ticking ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} мин` : `${Math.ceil(s / 60)} мин`;
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
    answering,
    answerState,
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
    liveAudio,
    musicOn,
    soundOn,
    categories,
    player,
    playingWhile,
    user,
    avatar,
    back,
    guardLeaving,
    pageArt,
    verdict,
    stream,
    who,
    standingCard,
    clock,
    coming,
    dayWord,
    when,
    whileSeen,
    errorText,
    lifetime,
  } = kit);
  title("Роял");
  const view = signal<Evening | null>(null);
  // The line: dropped (being opened again), or a screen too many for the server (it says when to come back).
  const trouble = signal<"" | "down" | "busy">("");
  // The server's clock less this one's: the countdowns go by the server's.
  let skew = 0;
  const now = signal(Date.now());
  const tick = setInterval(() => now.set(Date.now() + skew), 1000);
  onCleanup(() => clearInterval(tick));

  // The stream follows the evening as whoever is signed in sees it: again once someone who only looked becomes a
  // player, by joining. Never once the screen is gone: joining answers after a wait, by when the player may have left.
  const life = lifetime();
  let as = user.peek()?.id ?? 0;
  const line = stream("/api/royal/events", {
    life,
    on: {
      message: (data) => {
        const v = JSON.parse(data) as Evening;
        // The board is everyone's: the player is told apart by their key.
        for (const p of v.players) p.me = p.key === v.me?.key;
        if (v.me) v.me.me = true;
        skew = v.now - Date.now();
        now.set(v.now);
        trouble.set("");
        view.set(v);
      },
      // A screen too many (the player's, the network's, or all): the browser comes back after the server's wait.
      busy: () => trouble.set("busy"),
    },
    down: (down) => {
      if (down) trouble.update((t) => t || "down");
    },
  });
  const joined = () => {
    const id = user.peek()?.id ?? 0;
    if (id !== as && !life.aborted) {
      as = id;
      line.reopen();
    }
  };

  playingWhile(() => {
    const phase = view()?.phase;
    return phase === "question" || phase === "reveal";
  });
  onCleanup(() => hush(false));
  // The screen stays on while the evening needs it: in the lobby, once in, and through the game.
  keepAwake(() => {
    const v = view();
    return !!v && (v.phase === "question" || v.phase === "reveal" || (v.phase === "lobby" && v.in));
  });

  // Each phase (and each question) is drawn once; what changes inside it follows the view. A question the server
  // shows again (it restarted) is drawn again, its time from then.
  const key = computed(() => {
    const v = view();
    return v ? `${v.phase}:${v.n}:${v.in}:${v.startsAt}:${v.question?.shown ?? 0}` : "";
  });
  // Leaving the game while in its standings costs it: it goes on without the player, their time running out on each
  // question, and the place they end in counts. Every way out asks first; one cut, playing on for themselves, isn't
  // asked.
  const leaveAsk = guardLeaving(
    "Излизаш от Роял? Играта продължава без теб: въпросите остават без отговор, а мястото ти се брои.",
    () => {
      const v = view();
      return !!v && (v.phase === "question" || v.phase === "reveal") && v.in && !v.out;
    },
  );
  // Each question's answer, by evening and question: a question drawn again (the server showing it again after a
  // restart) goes on with the answer on its way, or in.
  const answers = new Map<string, AnswerState>();
  let closed = false;
  onCleanup(() => {
    closed = true;
  });
  return h(
    "div",
    { class: "screen" },
    leaveAsk,
    () => {
      const t = trouble();
      if (!t) return null;
      return h(
        "p",
        { class: "status", role: "status" },
        t === "busy"
          ? "Твърде много екрани следят Роял в момента. Свързваме се отново след малко…"
          : "Връзката прекъсна. Свързваме се отново…",
      );
    },
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
          return [door(live, joined), question(live, v, answers, () => closed)];
        case "reveal":
          return [door(live, joined), reveal(live, v)];
        case "end":
          return end(live, v, now);
      }
    },
  );
}

/** The lobby's music, while it plays. */
let music: Bed | null = null;

/** Ends the lobby's music: as the games begin, with the motif's first two notes; else fading. */
function hush(begin: boolean): void {
  music?.stop(begin);
  music = null;
}

/** What Роял is, in a sentence: when, and how many on how many questions. */
const about = (nightly?: boolean) =>
  `${nightly ? "Всяка вечер" : "Петък, събота и неделя"} в 21:00. До 50 души, 15 въпроса.`;

/** How it's played, folded under the evening: the cuts, and the final. */
const rules =
  "Всички получават един и същ въпрос в един и същ миг. Грешката не те изважда: след 5-ия, 8-ия, 11-ия и 14-ия въпрос продължават тези с повече верни, а при равни — по-бързите. Последния въпрос играят трима. Отпадналите играят до края за себе си.";

/** How long until a moment, in words: „След 3 ч и 12 мин“; in the last hour to the second („След 12:05 мин“); nothing
 * a day or more ahead (the day says it). */
function until(ms: number): string {
  if (ms >= 24 * 3600_000) return "";
  if (ms < 3600_000) return `След ${left(ms, true)}`;
  const minutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `След ${hours} ч и ${minutes % 60} мин` : `След ${hours} ч`;
}

/** Before the lobby opens: the next evening's start, large, and the time to it; „Ще дойда“; how it's played, folded;
 * your rating, and how your last ones went. */
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
      { class: "card hero royal-next" },
      h("p", { class: "kicker" }, () => {
        const day = dayWord(view().startsAt, now());
        const evening = day === "днес" ? "тази вечер" : day === "утре" ? "утре вечер" : day.replace(/^във? /, "");
        return `Следващият Роял · ${evening}`;
      }),
      h("strong", { class: "royal-when" }, () => clock(view().startsAt)),
      h("p", { class: "royal-countdown", hidden: () => !until(view().startsAt - now()) }, () =>
        until(view().startsAt - now()),
      ),
      h("p", { class: "muted" }, () => `Входът се отваря в ${clock(view().opensAt)}.`),
      plan(true),
    ),
    h("details", { class: "more" }, h("summary", null, "Как се играе"), h("p", null, rules)),
    () => {
      const d = past();
      // The division once a game has moved the rating (play/unfold.go).
      return d ? [d.standing.rated ? standingCard(d.standing, true) : null, history(d.royals)] : null;
    },
  );
}

/** „Ще дойда“: saying you'll come to the next evening, and how many have (before the lobby opens, the gold button
 * there: `main`; and under an evening's standings). Those who said so are called as its lobby opens, if notifications
 * are on here. */
function plan(main = false): Child {
  const tonight = signal<Tonight | null>(null);
  const notified = signal<boolean | null>(null);
  const busy = signal(false);
  const error = signal("");
  // Again now and then: the screen may stay while the evening moves on (its standings show for a while).
  const load = () => api<Tonight>("GET", "/api/royal/tonight").then(tonight.set, () => {});
  load();
  whileSeen(load, 20_000);
  pushOn().then(notified.set, () => notified.set(false));
  const run = async (fn: () => Promise<void>) => {
    error.set("");
    busy.set(true);
    try {
      await fn();
    } catch (err) {
      error.set(errorText(err));
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
                  ? `Записа се. Ще ти напомним ${when(opensAt, t.glance.now)}.`
                  : "Записа се. Ела тук, щом входът се отвори.",
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
          : h(
              "button",
              { class: main ? "btn primary big" : "btn", disabled: busy, onclick: () => say(true) },
              "Ще дойда",
            ),
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
      error.set(errorText(err));
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

/** The rules in a line, for the lobby of one who hasn't played a Роял yet. */
const firstRules =
  "Грешката не те изважда: след 5-ия, 8-ия, 11-ия и 14-ия въпрос продължават тези с повече верни, а при равни — по-бързите.";

/** A lobby of two or three, as it is: what that makes of the cuts (play.RoyalKeep keeps at least two). */
const small: Record<number, string> = {
  2: "Засега сте двама: без отсявания, играете и петнадесетте въпроса.",
  3: "Засега сте трима: след 5-ия въпрос продължават двама, до края.",
};

/** Whether the player hasn't played a Роял yet (or isn't a player yet): the lobby tells them how it's played. */
function firstTimer(): Signal<boolean> {
  const fresh = signal(!user.peek());
  if (user.peek())
    api<{ royals: Past[] }>("GET", "/api/royal").then(
      (r) => fresh.set(r.royals.length === 0),
      () => {},
    );
  return fresh;
}

function lobby(view: () => Evening, now: Signal<number>, joined: () => void): Child {
  // The lobby as it was drawn, read untracked: else every view sent would draw it again (its music anew).
  const v0 = untracked(view);
  const newcomer = firstTimer();
  // Those whose notifications are on here are called a minute before the start, if their screen is away.
  const notified = signal(false);
  if (v0.in) pushOn().then(notified.set, () => {});
  // Those in hear the music while they wait (and when the sound or the music is turned off, it fades), and the last
  // three seconds.
  effect(() => {
    now(); // each second: the first touch, which lets the sound start, may come at any time
    if (!soundOn() || !musicOn() || !v0.in) return hush(false);
    const live = music ? null : liveAudio();
    if (!live) return;
    music = live.feel.bed(live.audio);
    music.until(live.audio.currentTime + (v0.startsAt - untracked(now)) / 1000);
  });
  // Leaving the lobby for anything but the game ends it (the game's first question ends it its own way).
  onCleanup(() => untracked(view).phase !== "question" && hush(false));
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
        h("span", { class: "royal-count" }, () => left(view().startsAt - now(), true)),
      ),
      h("p", { class: "lead" }, () =>
        v0.in
          ? notified()
            ? "Вътре си. Ако излезеш от екрана, ще ти напомним минута преди началото."
            : `Вътре си. Остани на този екран до ${clock(v0.startsAt)}.`
          : `В ${clock(v0.startsAt)} всички получават първия въпрос едновременно. Закъснелите влизат до 3-тия въпрос.`,
      ),
      // How it's played, in a line, for one who hasn't played a Роял yet; and how few are in, if few are.
      () => (newcomer() ? h("p", { class: "muted" }, firstRules) : null),
      () => {
        const n = view().left;
        return n === 2 || n === 3 ? h("p", { class: "muted" }, small[n]) : null;
      },
    ),
    entry(joined, v0.in),
    () => {
      const v = view();
      if (!v.left) return h("p", { class: "muted" }, "Още никой не е влязъл.");
      // A crowd shows as its first few (you among them), and how many more.
      const few = [...(v.me ? [v.me] : []), ...v.players.filter((p) => !p.me)].slice(0, 12);
      return h(
        "section",
        { class: "card" },
        h("h2", { class: "section-title" }, `Вътре: ${v.left}`),
        chips(few.map((p) => ({ ...p, in: !!p.online || !!p.me }))),
        v.left > few.length ? h("p", { class: "muted" }, `и още ${v.left - few.length}`) : null,
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
    const me = v.me;
    const c = v.cut;
    // Before the first answer there's no standing to speak of: everyone is level.
    const first = v.phase === "question" && v.n === 0;
    const where = !me
      ? null
      : !me.in
        ? `Извън класирането: отпадна след ${nth(me.outAt + 1)}.`
        : first
          ? null
          : `На ${ordinal(me.rank, "n")} място си: ${rights(me.reached)}, ${seconds(me.ms)}.`;
    const wins = "Печели този с най-много верни, а при равни — по-бързият.";
    let line: string;
    // No cut ahead that could put anyone out (two players, or a few left after an earlier cut): the game goes to its
    // end as it is; the last question alone is the final.
    if (!c && v.n < v.length - 1)
      line = v.entered < 4 && first ? `Малък турнир: без отсявания до края. ${wins}` : `Оттук без отсявания. ${wins}`;
    else if (!c) line = `Финал: ${wins.charAt(0).toLowerCase()}${wins.slice(1)}`;
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
  const me = v.me;
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

/** Which rows of the standings show, as an answer does (a few seconds to look): all of a short board; of a long one,
 * the first three and those around the player and the line, the rest left out (a gap). */
function shown(ps: Player[]): boolean[] {
  if (ps.length <= 12) return ps.map(() => true);
  const keep = ps.map((_, i) => i < 3);
  const near = (at: number) => {
    for (let i = Math.max(0, at - 2); i <= at + 2 && i < ps.length; i++) keep[i] = true;
  };
  near(ps.findIndex((p) => p.me));
  near(ps.findIndex((p, i) => p.goes && !ps[i + 1]?.goes));
  return keep;
}

/** The standings as the answer showing leaves them: those who go on (or would, at the next cut) marked, the line
 * between, and those out below. */
function standings(v: Evening): Child {
  const c = v.cut;
  const rows: Child[] = [];
  const keep = shown(v.players);
  v.players.forEach((p, i, all) => {
    if (!keep[i]) return;
    rows.push(
      h(
        "li",
        {
          class: ["row", p.goes && "up", !p.in && "out", p.me && "me", i > 0 && !keep[i - 1] && "gap"]
            .filter(Boolean)
            .join(" "),
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
          c.now ? "Дотук продължават" : `Дотук продължават след ${nth(c.after)}`,
        ),
      );
    }
  });
  return h("section", { class: "board league-board royal-table" }, h("h2", null, "Класиране"), h("ol", null, rows));
}

/** A question, to answer while its time runs (game/answering.ts). An answer that doesn't get through is sent again
 * while the question is open, the same when the server shows the question again after a restart (gone: the screen
 * is; `answers`: each question's answer, kept for the question drawn anew); one refused for good frees the options
 * again. A watcher (not in) sees the options, and the clock run to the end. */
function question(view: () => Evening, first: Evening, answers: Map<string, AnswerState>, gone: () => boolean): Child {
  const q = first.question;
  if (!q) return null;
  const key = `${first.startsAt}:${first.n}`;
  const state = answers.get(key) ?? answerState();
  answers.set(key, state);
  // The game starts: with the music's end, or a sound of its own (not again for the question drawn anew).
  if (music) hush(first.n === 0);
  else if (first.n === 0 && first.in && !first.given && state.step.peek() === "") play("go");
  // Those cut play on, off the standings.
  const plays = first.in;
  const ans = answering({
    view: q.view,
    leftMs: first.leftMs,
    post: (answer) => api("POST", "/api/royal/answer", { n: first.n, answer }),
    open: () => !gone() && view().phase === "question" && view().n === first.n,
    // The server has this player's answer (sent from here, or before the question was drawn again).
    inView: () => {
      const v = view();
      return v.phase === "question" && v.n === first.n && !!v.given;
    },
    plays,
    state,
  });
  // More of the question shows as its time runs (the next clue), and the clock goes by the server's.
  effect(() => {
    const v = view();
    if (v.n === first.n && v.question && v.phase === "question") ans.follow(v.question.view, v.leftMs);
  });
  return h(
    "article",
    { class: "question" },
    head(first),
    timer(first.leftMs, q.limitMs, ans.left, ans.stopped), // a watcher's clock runs to the end
    ans.heading,
    picture(q.view, true),
    ans.asked.node,
    () => {
      const v = view();
      // The answer waits for everyone playing, those cut too.
      const done = v.answered;
      return h(
        "p",
        { class: "status", role: "status" },
        !plays ? "Гледаш. " : v.out ? "Извън класирането. " : "",
        ans.taken() ? "Отговорът ти е приет. " : "",
        `Отговориха ${done} от ${v.playing}.`,
      );
    },
    ans.said,
    standing(view),
  );
}

function reveal(view: () => Evening, first: Evening): Child {
  const q = first.question;
  const r = q?.reveal;
  if (!q || !r) return null;
  // How the player's answer went (none: they weren't in for it).
  const m = first.mine;
  const kind: VerdictKind = m?.missed ? "time" : m?.exact ? "exact" : m?.right ? "right" : "wrong";
  if (m) playAnswer(kind, m.right ? 1 : 0);
  return h(
    "article",
    { class: "question" },
    head(first),
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view, true),
    answered(q.view, r.answer, m ? (first.given ?? null) : null),
    m ? verdict(kind, m.points, m.missed ? "Времето изтече." : undefined, m.speed) : null,
    crowdLine(q.view.type, r.answer.crowd, !!m?.right),
    cutSaid(first),
    standing(view),
    upNext(first.nextMs ?? 0, first.last ? "Към класирането…" : `Въпрос ${first.n + 2} след малко…`),
    standings(first),
  );
}

function end(view: () => Evening, first: Evening, now: Signal<number>): Child {
  const me = first.me;
  const [best] = first.players;
  const won = me?.place === 1 && first.entered > 1;
  if (me) play(won ? "win" : "end");
  // Whether the day's ten still wait for the player (null: not known yet).
  const dayWaits = signal<boolean | null>(user.peek() ? null : true);
  if (user.peek())
    api<{ run: { done: boolean } | null }>("GET", "/api/day").then(
      (t) => dayWaits.set(!t.run?.done),
      () => dayWaits.set(false),
    );
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
    // What next, in gold: the day's ten if they still wait, else „Ще дойда“ to the next evening.
    () => {
      const d = dayWaits();
      if (d === null) return null;
      return d ? [h("a", { class: "btn primary big", href: "/" }, "Към въпросите на деня"), plan()] : plan(true);
    },
    first.runId
      ? review(async () => (await api<{ questions: Reviewed[] }>("GET", `/api/runs/${first.runId}/review`)).questions)
      : null,
  );
}
