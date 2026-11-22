// Дуел: two players on the same ten questions, each on their own time (play/duels.go). With a friend: the player plays
// first, and the friend, told, plays the same ten when they can (seven days); whoever plays second sees both at once.
// Or against a recording: a real player's finished game, its answers shown as they came. A duel is played as any
// game is (game/run.ts), with the other's answers beside the player's once they've given theirs. Приятели lists the
// duels (duelLists: theirs to play, waiting, played); „Нов дуел“ (/duel/new) starts one; one duel's page (/duel/<id>)
// plays it, or shows how it ended (screens/outcome.ts, loaded on its own: kit.ts).

import { news } from "../game/news.ts";
import { summary } from "../game/results.ts";
import { getReady, playRun, shownHere, starting, startScreen } from "../game/run.ts";
import type { Reviewed, State } from "../game/types.ts";
import { duelResult } from "../kit.ts";
import { type ApiError, api, errorText } from "../lib/api.ts";
import { type Child, effect, h, lifetime, signal, slot } from "../lib/dom.ts";
import { backOut, byTap, go, hold, title } from "../lib/router.ts";
import { leftWords, withWord } from "../lib/words.ts";
import { player, topics, user } from "../state.ts";
import { avatar, back, failure, formatNumber, type Look, nameWords, who } from "../ui.ts";
import { missing } from "./missing.ts";
import { nameFirst } from "./name.ts";
import { signIn } from "./signin.ts";

/** How one question of a duel went for one side: right, or close (not right), and whether nothing was given; never
 * when it was answered (play.DuelMark: a duel isn't a race). */
export interface DuelMark {
  right: boolean;
  close?: boolean;
  missed?: boolean;
}

export interface Side {
  name: string;
  tag?: string;
  rights: number;
  done: boolean;
  look?: Look;
  /** A player who has gone since (play.DuelSide.Gone): their game went with them, so their score isn't known. */
  gone?: boolean;
  /** How each question went (one duel's view): the player's own; the other's once there's a result (while the player
   * plays, the run has the other's as far as they've come: State.against). */
  marks?: DuelMark[];
}

/** A duel as the player sees it (play.DuelView): theirs to play (sent to them, or their own side not finished), sent
 * and waiting for the friend, won, lost, drawn, or expired (not played in time: `lapsed` says by whom; or, from
 * before, cut off). */
export interface DuelView {
  id: number;
  state: "yours" | "theirs" | "won" | "lost" | "draw" | "expired";
  opponent?: Side;
  you?: Side;
  recorded?: boolean;
  /** Against a recording: as it was chosen, as strong as the player („равен“) or stronger („по-силен“). */
  level?: Level;
  /** Against a recording of one topic's game: the topic. */
  topic?: string;
  /** The player played first (sent it). */
  first?: boolean;
  runId?: number;
  createdAt: number;
  endedAt?: number;
  /** When an open duel lapses. */
  until?: number;
  lapsed?: "you" | "they";
  /** One duel's view: the player's own game can still be gone over (play.DuelView.Review: on the day it ended). */
  review?: boolean;
  /** One duel's view, of one won on even right answers: what broke the tie (play.DuelView.TieBy), the number nearer. */
  tieBy?: "number";
  record?: { won: number; lost: number; drawn: number };
  /** The other is a friend now (`them`, their id): a rematch is a tap away. */
  friend?: boolean;
  them?: number;
}

/** A recording as it's chosen (play.Even, play.Stronger): about as strong as the player, or stronger. */
export type Level = "even" | "stronger";

/** What a recording is called, by the level it was chosen at: „По-силен запис“, „Равен запис“; „Запис“ where it was
 * only the nearest there was to it (play.DuelRecording keeps no level then). */
export const recordingName = (level?: Level) =>
  level === "stronger" ? "По-силен запис" : level === "even" ? "Равен запис" : "Запис";

/** Who a duel is with, to start one: a friend (by their id), or a recording at a level. */
type To = { friend: number } | { recording: true; level: Level };

/** The level the player last chose a recording at, while the page is open, for „Още един дуел срещу запис“: the
 * server keeps only the level met (another page asks for that, or „равен“). Nothing of it is kept on the device. */
let lastLevel: Level | undefined;

/** The player's duels, as Приятели lists them (play.Duels). */
export interface Duels {
  yours: DuelView[];
  theirs: DuelView[];
  played: DuelView[];
}

/** A duel as its screens show it: a player gone since shows as nobody's, a plain tile without an animal (no avatar of
 * theirs, nor one drawn from a name that isn't theirs). */
const shown = (d: DuelView): DuelView =>
  d.opponent?.gone ? { ...d, opponent: { ...d.opponent, look: { avatar: "gone" } } } : d;

/** One of the player's duels, as its screen shows it. */
const oneDuel = async (id: number) => shown((await api<{ duel: DuelView }>("GET", `/api/duels/${id}`)).duel);

/** Starts a duel: with a friend (by their id), or against a recording; the player made first if need be, and asked
 * for a name of their own if they still have the one drawn for them (a friend sees it). It says the duel. */
export async function startDuel(to: To): Promise<DuelView | null> {
  await player();
  if ("friend" in to && !(await nameFirst())) return null;
  if ("recording" in to) lastLevel = to.level;
  return shown((await api<{ duel: DuelView }>("POST", "/api/duels", to)).duel);
}

/** What broke a tie on even right answers (DuelView.tieBy), as a duel's row and its result say it: „равен брой верни ·
 * реши по-близкото число“, the only thing that breaks one (time never counts: even in both, it's „Равенство“, with
 * nothing more to say); "" for a duel won on right answers, a draw, or none ended. */
export function tieWords(d: DuelView): string {
  if (d.state !== "won" && d.state !== "lost") return "";
  return d.tieBy === "number" ? "равен брой верни ·\u00a0реши по-близкото число" : "";
}

/** What a duel's card says on one quiet line under its two sides; "" for nothing to say. An open one: that the
 * player's own game is begun and not finished, or their score while the other has the same ten to play. A played one:
 * why one that ran out has no score, that a player is gone (their game went with them), and what broke a tie on even
 * right answers. The pair's record is said once, on the friend (Приятели), not on each duel. */
function noteLine(d: DuelView): string {
  const them = d.opponent;
  if (d.state === "yours") return d.first ? "Довърши своята игра." : "";
  if (d.state === "theirs") return `Ти: ${formatNumber(d.you?.rights ?? 0)} от 10`;
  if (d.state === "expired") {
    if (d.lapsed === "they") return `${them?.name ?? "Приятелят"} не го изигра навреме.`;
    if (d.lapsed === "you") return "Не го изигра навреме.";
    return "Без резултат.";
  }
  if (them?.gone) return "Играчът вече го няма.";
  const said = tieWords(d);
  return said && `${said.charAt(0).toUpperCase()}${said.slice(1)}`;
}

/** One side of a duel's card: the avatar with its seal, the name under it (the player's own: „Ти“). */
const cardSide = (name: string, look: Look, plainName: string): Child =>
  h(
    "span",
    { class: "duel-card-side" },
    avatar(look.avatar, { name: plainName, seal: look.seal }),
    h("span", { class: "duel-card-name" }, nameWords(name)),
  );

/** What stands between a card's two sides: an open duel's turn („Твой ред“, „Чакаш“) over how long is left; a played
 * one's score, a heavy numeral („8:6“), over its end as a chip, told apart at a glance: a win filled in ink with its ✓
 * (right is ink, filled), a loss outlined and quiet (never red: a loss isn't punished), a draw outlined in ink; one
 * that ran out, „Изтече“ alone. */
function cardMiddle(d: DuelView): Child {
  if (d.state === "yours" || d.state === "theirs")
    return [
      h("strong", { class: "duel-card-state" }, d.state === "yours" ? "Твой ред" : "Чакаш"),
      h("span", { class: "duel-card-left" }, leftWords(d.until ?? 0)),
    ];
  if (d.state === "expired") return h("strong", { class: "duel-card-state" }, "Изтече");
  return [
    d.opponent?.gone
      ? null
      : h(
          "b",
          { class: "duel-card-score" },
          `${formatNumber(d.you?.rights ?? 0)}:${formatNumber(d.opponent?.rights ?? 0)}`,
        ),
    h(
      "strong",
      { class: `duel-chip ${d.state}` },
      d.state === "won" ? "✓ Победа" : d.state === "lost" ? "Загуба" : "Равенство",
    ),
  ];
}

/** A duel as a card, the whole of it one link to the duel (no name in it is a way to a profile, so none looks like
 * one): its kind at the top („С приятел“, „Срещу запис“), then the two face to face, the player on the left, with
 * how it stands between them (cardMiddle), and what more there is to say on one quiet line (noteLine). `play`: the
 * duel waiting for the player first, with „Играй“, the page's one action, in it. */
function duelCard(d: DuelView, play = false): Child {
  const them = d.opponent;
  const note = noteLine(d);
  return h(
    "li",
    null,
    h(
      "a",
      { class: `duel-card s-${d.state}${play ? " turn" : ""}`, href: `/duel/${d.id}` },
      h("span", { class: "duel-card-kind" }, d.recorded ? "Срещу запис" : "С приятел"),
      h(
        "span",
        { class: "duel-card-sides" },
        cardSide("Ти", d.you?.look ?? {}, d.you?.name ?? ""),
        h("span", { class: "duel-card-mid" }, cardMiddle(d)),
        cardSide(them?.name ?? "Съперник", them?.look ?? {}, them?.name ?? ""),
      ),
      note ? h("span", { class: "duel-card-note" }, note) : null,
      play ? h("span", { class: "btn primary duel-card-go" }, "Играй") : null,
    ),
  );
}

/** How many played duels Приятели lists. */
const playedShown = 5;

/** The player's duels in Приятели: the open ones first, theirs to play (the first of them with the page's one action,
 * „Играй“) and then those waiting for a friend, each card saying whose turn it is; under „Изиграни“, those played. */
export function duelLists(d: Duels): Child {
  const open = [...d.yours, ...d.theirs].map(shown);
  const played = d.played.slice(0, playedShown).map(shown);
  return [
    open.length
      ? h(
          "ul",
          { class: "duel-cards" },
          open.map((o, i) => duelCard(o, i === 0 && o.state === "yours")),
        )
      : null,
    played.length
      ? h(
          "section",
          { class: "stack small-gap" },
          h("h2", { class: "section-title" }, "Изиграни"),
          h(
            "ul",
            { class: "duel-cards" },
            played.map((p) => duelCard(p)),
          ),
        )
      : null,
  ];
}

/** A friend's yes to the player's request, as Приятели hears of it (play.AcceptedOf). */
export interface Accepted {
  id: number;
  name: string;
  line: string;
}

/** Lines told on this page already: Приятели drawn again doesn't say them twice. */
const toldHere = new Set<unknown>();

/** Tells a line once, wherever the player is signed in (the server keeps it as told): whether it's news here. */
function toldOnce(line: string): boolean {
  if (toldHere.has(line)) return false;
  toldHere.add(line);
  api("POST", "/api/told", { line }).catch(() => {});
  return true;
}

/** A friend said yes to the player's request: said once, in Приятели, over the friends. */
export function acceptedLine(a?: Accepted | null): Child {
  if (!a || !toldOnce(a.line)) return null;
  return h("p", { class: "notice accepted-notice", role: "status" }, `${a.name} прие поканата ти за приятелство.`);
}

interface Friend {
  id: number;
  name: string;
  tag: string;
  avatar?: string;
  /** The seal they wear on their avatar's corner (play.Seal). */
  seal?: { chapter: string; level: number };
}

/** Нов дуел: with a friend (each a tap), or against a recording of a real game. */
export function duelNew() {
  title("Нов дуел");
  const friends = signal<Friend[] | null>(null);
  const error = signal("");
  const busy = signal(false);
  if (user.peek())
    api<{ friends: Friend[] }>("GET", "/api/friends").then(
      (r) => friends.set(r.friends),
      () => friends.set([]),
    );
  else friends.set([]);
  // A recording to play against: offered only while there is one.
  const recording = signal(false);
  api<{ ready: boolean }>("GET", "/api/duels/recording").then(
    (r) => recording.set(r.ready),
    () => {},
  );
  const begin = async (to: To) => {
    if (busy.peek()) return;
    busy.set(true);
    error.set("");
    try {
      const d = await startDuel(to);
      if (d) go(`/duel/${d.id}`);
    } catch (err) {
      error.set(errorText(err));
    } finally {
      busy.set(false);
    }
  };
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      back("/friends", "Приятели"),
      h("h1", null, "Нов дуел"),
      h("p", { class: "lead" }, "Десет въпроса. Ти ги играеш сега, а приятелят ти — когато може."),
    ),
    h("section", { class: "stack small-gap" }, h("h2", { class: "section-title" }, "С приятел"), () => {
      const list = friends();
      if (!list) return h("p", { class: "muted" }, "…");
      if (!list.length)
        return h(
          "p",
          { class: "muted" },
          "Още нямаш приятели тук. ",
          h("a", { href: "/friends" }, "Добави ги в Приятели"),
          ".",
        );
      return h(
        "ul",
        { class: "duel-picks" },
        list.map((f) => {
          // Two friends of one name: each said with their @username, to tell them apart.
          const same = list.some((o) => o.id !== f.id && o.name === f.name);
          return h(
            "li",
            null,
            h(
              "button",
              {
                class: "duel-pick",
                type: "button",
                disabled: busy,
                "aria-label": `Дуел ${withWord(f.name)}${same ? ` (@${f.tag})` : ""}`,
                onclick: () => begin({ friend: f.id }),
              },
              who(f.name, f, same ? h("span", { class: "who-tag" }, ` @${f.tag}`) : null, f.name),
              h("strong", { class: "duel-invite" }, "Дуел"),
            ),
          );
        }),
      );
    }),
    () =>
      recording()
        ? h(
            "section",
            { class: "stack small-gap" },
            h("h2", { class: "section-title" }, "Срещу запис"),
            h(
              "p",
              { class: "muted" },
              "Играеш десетте въпроса от истинска игра на друг играч и след всеки виждаш как е отговорено в нея. Равен: на твоето ниво. По-силен: малко над него.",
            ),
            (["even", "stronger"] as const).map((level) =>
              h(
                "button",
                { class: "btn", type: "button", disabled: busy, onclick: () => begin({ recording: true, level }) },
                recordingName(level),
              ),
            ),
          )
        : null,
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

/** The duel isn't this player's, as far as the server can tell: signed out (another phone, another browser), or in a
 * profile kept with an email they haven't signed in with here. Signing in opens it. */
function notHere(signedIn: () => void): Child {
  const u = user.peek();
  if (u?.email)
    return h(
      "section",
      { class: "screen" },
      h(
        "div",
        { class: "intro" },
        h("p", { class: "kicker" }, "Дуел"),
        h("h1", null, "Не намираме този дуел"),
        h("p", { class: "lead" }, "Или е в друг профил, или вече го няма."),
      ),
      h("a", { class: "btn primary big", href: "/friends" }, "Към Приятели"),
    );
  effect(() => {
    if (user()?.email) signedIn();
  });
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Дуел"),
      h("h1", null, "Дуелът е в профила ти"),
      h("p", { class: "lead" }, "Влез с имейла на профила си и го виж тук."),
    ),
    h("section", { class: "card" }, signIn({ form: "duel" })),
  );
}

/** What a duel is called over its game: „Дуел с Мария“; against a recording, how it was chosen and whose:
 * „По-силен запис · Краси“ (of a topic's game: „… · История“). */
function duelName(d: DuelView): string {
  const them = d.opponent?.name ?? "";
  if (!d.recorded) return `Дуел ${withWord(them)}`;
  const topic = d.topic ? topics.find((t) => t.id === d.topic)?.name : "";
  return `${recordingName(d.level)} · ${them}${topic ? ` · ${topic}` : ""}`;
}

/** A friend's duel the player has just played first: sent, the friend told. Their own result, and where it went. */
function sent(d: DuelView, s: State, just: boolean): Child {
  const them = d.opponent?.name ?? "Приятелят";
  return h(
    "div",
    { class: "screen" },
    summary(
      s,
      // In the card, under its name: sent, and how long the friend has.
      [
        h("div", { class: "day-line" }, h("span", { class: "kicker" }, duelName(d))),
        h(
          "p",
          { class: "duel-sent" },
          `Дуелът е изпратен. ${them} ще изиграе същите десет въпроса: има време ${leftWords(d.until ?? Date.now() + 7 * 86_400_000)}. Ще видиш резултата, щом ги изиграе.`,
        ),
      ],
      {
        main: h("a", { class: "btn primary big", href: "/friends" }, "Към Приятели"),
        also: [h("a", { class: "btn", href: "/duel/new" }, "Нов дуел")],
      },
      [just ? news(s.id) : null],
      just,
    ),
  );
}

/** A gold button that starts another duel (a rematch, the other way round; another recording), and says so if it
 * can't (a limit reached). */
function again(label: string, to: To): Child {
  const said = signal("");
  const busy = signal(false);
  return h(
    "div",
    { class: "stack small-gap" },
    h(
      "button",
      {
        class: "btn primary big",
        type: "button",
        disabled: busy,
        onclick: async () => {
          busy.set(true);
          said.set("");
          try {
            const next = await startDuel(to);
            if (next) go(`/duel/${next.id}`);
          } catch (err) {
            said.set(errorText(err));
          } finally {
            busy.set(false);
          }
        },
      },
      label,
    ),
    () => said() && h("p", { class: "bad", role: "alert" }, said()),
  );
}

/** One duel: played (the player's side, if it's theirs), waiting for the friend, or how it ended. */
export function duelOne(params: string[]) {
  title("Дуел");
  const id = Number(params[0]);
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  // What comes back once the screen is gone (another page opened meanwhile) does nothing.
  const life = lifetime();
  const tap = byTap();

  // How the duel stands, drawn: the result (with a rematch, a new duel), the wait, or the player's side to play.
  const show = (d: DuelView, just = false, run?: State) => {
    if (d.state === "yours") return ready(d);
    if (d.state === "theirs") {
      if (run) return screen.show(() => sent(d, run, just));
      return void api<State>("GET", `/api/runs/${d.runId}`).then(
        (s) => !life.aborted && screen.show(() => sent(d, s, false)),
        (err) => !life.aborted && screen.show(() => failure(err, () => void load(), ["/friends", "Към Приятели"])),
      );
    }
    const toFriends = (main: boolean) =>
      h("a", { class: main ? "btn primary big" : "btn", href: "/friends" }, "Към Приятели");
    const next =
      d.friend && d.them
        ? again("Реванш", { friend: d.them })
        : d.recorded
          ? again("Още един дуел срещу запис", { recording: true, level: lastLevel ?? d.level ?? "even" })
          : null;
    // Its questions come with it while they can be gone over (the day the player's own game ended); without them
    // (later, or should they not come) the result is whole, its marks in their place.
    const questions: Promise<Reviewed[] | null> = d.review
      ? api<{ questions: Reviewed[] }>("GET", `/api/runs/${d.runId}/review`).then(
          (r) => r.questions,
          () => null,
        )
      : Promise.resolve(null);
    void questions.then((all) => {
      if (life.aborted) return;
      screen.show(() =>
        duelResult(
          d,
          { main: next ?? toFriends(true), also: next ? toFriends(false) : null },
          just && d.runId ? news(d.runId) : null,
          all,
        ),
      );
    });
  };

  // The player's side: straight in where this tab was showing its question, after a count when a tap brought them,
  // else what it is and „Започни“ (or „Продължи“ where it was left).
  const ready = async (d: DuelView) => {
    const name = duelName(d);
    let s: State | null = null;
    if (d.runId) s = await api<State>("GET", `/api/runs/${d.runId}`).catch(() => null);
    if (life.aborted) return;
    if (s && !s.done && s.question && shownHere(s.id)) return play(d, s);
    const begin = () => {
      hold();
      screen.show(() =>
        getReady(
          name,
          () => void start(d),
          () => backOut("/friends", () => void ready(d)),
        ),
      );
    };
    if (tap && !s?.at) return begin();
    const lead = d.recorded
      ? `Десетте въпроса от истинска игра на ${d.opponent?.name ?? "друг играч"}. След всеки отговор виждаш как е минал въпросът в записа.`
      : d.first
        ? `Десет въпроса. После ${d.opponent?.name ?? "приятелят ти"} ще изиграе същите.`
        : `Същите десет въпроса, които изигра ${d.opponent?.name ?? "приятелят ти"}. След всеки отговор виждаш отговора на ${d.opponent?.name ?? "приятеля ти"}.`;
    screen.show(() =>
      startScreen(name, lead, s?.at ? { at: s.at, total: s.total, marks: s.trail } : null, () =>
        s?.at ? void start(d) : begin(),
      ),
    );
  };

  // Its run, made as it's first played (the friend's side), then played.
  const start = async (d: DuelView) => {
    screen.show(starting);
    try {
      const now = shown((await api<{ duel: DuelView }>("POST", `/api/duels/${d.id}/play`, {})).duel);
      const s = await api<State>("GET", `/api/runs/${now.runId}`);
      if (!life.aborted) play(now, s);
    } catch (err) {
      if (life.aborted) return;
      // Gone while its start waited (left before its first question showed, for long: play.DuelUnbegun).
      if ((err as ApiError).code === "duel_gone") return screen.show(missing);
      screen.show(() =>
        h(
          "div",
          { class: "stack" },
          h("p", { role: "alert" }, errorText(err)),
          h("button", { class: "btn primary", onclick: () => void start(d) }, "Опитай пак"),
        ),
      );
    }
  };

  // Played as any game, the other's answers beside the player's (when the other has played: the run has them, each as
  // far as the player has come); its end, the duel again.
  const play = (d: DuelView, s: State) => {
    screen.show(() =>
      playRun(
        s,
        (end) => {
          const after = slot(() => h("p", { class: "muted" }, "…"));
          oneDuel(id).then(
            (now) => !life.aborted && show(now, true, end),
            (err) => !life.aborted && after.show(() => failure(err, () => void load(), ["/friends", "Към Приятели"])),
          );
          return h("div", null, after);
        },
        duelName(d),
        d.opponent?.name ?? "",
      ),
    );
  };

  const load = async () => {
    try {
      const d = await oneDuel(id);
      if (!life.aborted) show(d);
    } catch (err) {
      if (life.aborted) return;
      const code = (err as ApiError).code;
      // No such duel at all (never was, or gone; the server tells anyone that): the page isn't there, not a sign-in.
      if (code === "duel_gone") return screen.show(missing);
      // There, but not this profile's: it may be the player's in another one.
      if (code === "signed_out" || code === "no_duel") return screen.show(() => notHere(() => void load()));
      screen.show(() => failure(err, () => void load(), ["/friends", "Към Приятели"]));
    }
  };
  load();
  return h("div", null, screen);
}
