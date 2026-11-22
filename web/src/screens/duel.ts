// Дуел: two players on the same ten questions, each on their own time (play/duels.go). With a friend: the player plays
// first, and the friend, told, plays the same ten when they can (seven days); whoever plays second sees both at once.
// Or against a recording: a real player's finished game, its answers shown as they came. A duel is played as any
// game is (game/run.ts), with the other's answers beside the player's once they've given theirs. „Нов дуел“
// (/duel/new) starts one; one duel's page (/duel/<id>) is where it's played, and nothing else: everything about a duel
// is on its card in Приятели's „Дуели“ (screens/duelcards.ts), where its game's end lands, and where the page of a
// duel not the player's to play goes (an old link to its result, a notification of it).

import { getReady, playRun, shownHere, starting, startScreen } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { type ApiError, api, errorText } from "../lib/api.ts";
import { type Child, effect, h, lifetime, signal, slot } from "../lib/dom.ts";
import { backOut, byTap, go, hold, title } from "../lib/router.ts";
import { loadFeel } from "../lib/sound.ts";
import { withWord } from "../lib/words.ts";
import { player, topics, user } from "../state.ts";
import { avatar, back, failure, type Look, nameWords, record } from "../ui.ts";
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
  /** How each question went, of a duel the player has played their side of: the player's own; the other's once
   * there's a result (while the player plays, the run has the other's as far as they've come: State.against). */
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
  /** Of one won on even right answers: what broke the tie (play.DuelView.TieBy), the number nearer. */
  tieBy?: "number";
}

/** Who a duel is with, to start one: a friend (by their id), or a recording (one kind: the game nearest to the
 * player, play.DuelRecording). */
export type To = { friend: number } | { recording: true };

/** The player's duels, as Приятели lists them (play.Duels). */
export interface Duels {
  yours: DuelView[];
  theirs: DuelView[];
  played: DuelView[];
}

/** One of the player's duels. */
const oneDuel = async (id: number) => (await api<{ duel: DuelView }>("GET", `/api/duels/${id}`)).duel;

/** Starts a duel: with a friend (by their id), or against a recording; the player made first if need be, and asked
 * for a name of their own if they still have the one drawn for them (a friend sees it). It says the duel. */
export async function startDuel(to: To): Promise<DuelView | null> {
  await player();
  if ("friend" in to && !(await nameFirst())) return null;
  return (await api<{ duel: DuelView }>("POST", "/api/duels", to)).duel;
}

/** Where a duel's card is, in Приятели's „Дуели“: the duel named in the address comes first there. */
const cardHref = (id: number) => `/friends?tab=duels&duel=${id}`;

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
  /** The duels between the two (play.Friend): the one count kept between two players. */
  won: number;
  lost: number;
  drawn: number;
}

/** Нов дуел: with a friend, each a row that starts one (the whole row a button: its line lights under a pointer, no
 * name in it underlined, for it's no way to a profile), the duels between the two under the name in Приятели's
 * tooltip's words („Дуели помежду ви: 3 победи, 1 загуба“, or „Още нямате дуели“) and „Дуел“ at its end; or against a
 * recording of a real game, one kind of it, offered while there is one. */
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
      back("/friends?tab=duels", "Дуели"),
      h("h1", null, "Нов дуел"),
      h("p", { class: "lead" }, () =>
        recording()
          ? "Десет въпроса. С приятел — той ги играе, когато може. Срещу запис — веднага."
          : "Десет въпроса. Ти ги играеш сега, а приятелят ти — когато може.",
      ),
    ),
    h("section", { class: "stack small-gap" }, h("h2", { class: "section-title" }, "С приятел"), () => {
      const list = friends();
      if (!list) return h("p", { class: "muted" }, "…");
      if (!list.length)
        return h(
          "p",
          { class: "muted" },
          "Още нямаш приятели тук. ",
          h("a", { href: "/friends?tab=friends" }, "Добави ги в Приятели"),
          ".",
        );
      return h(
        "ul",
        { class: "duel-picks" },
        list.map((f) => {
          // Two friends of one name: each said with their @username, to tell them apart.
          const same = list.some((o) => o.id !== f.id && o.name === f.name);
          const played = f.won + f.lost + f.drawn > 0;
          return h(
            "li",
            null,
            h(
              "button",
              {
                class: "duel-pick",
                type: "button",
                disabled: busy,
                "aria-label": `Дуел ${withWord(f.name)}${same ? ` (@${f.tag})` : ""}. ${
                  played ? `Дуели помежду ви: ${record(f.won, f.lost, f.drawn)}` : "Още нямате дуели"
                }.`,
                onclick: () => begin({ friend: f.id }),
              },
              avatar(f.avatar, { name: f.name, seal: f.seal }),
              h(
                "span",
                { class: "duel-pick-text" },
                h(
                  "span",
                  { class: "duel-pick-name" },
                  nameWords(f.name, same ? h("span", { class: "who-tag" }, ` @${f.tag}`) : null),
                ),
                h(
                  "span",
                  { class: "duel-pick-record" },
                  played ? ["Дуели помежду ви: ", h("b", null, record(f.won, f.lost, f.drawn))] : "Още нямате дуели",
                ),
              ),
              h("span", { class: "duel-invite" }, "Дуел"),
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
              "Изиграй същите десет въпроса срещу истинска игра на играч, който знае горе-долу колкото теб.",
            ),
            h(
              "button",
              { class: "btn", type: "button", disabled: busy, onclick: () => begin({ recording: true }) },
              "Играй срещу запис",
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

/** What a duel is called over its game: „Дуел с Мария“; against a recording, whose it is: „Запис · Краси“ (of a
 * topic's game: „… · История“). */
function duelName(d: DuelView): string {
  const them = d.opponent?.name ?? "";
  if (!d.recorded) return `Дуел ${withWord(them)}`;
  const topic = d.topic ? topics.find((t) => t.id === d.topic)?.name : "";
  return `Запис · ${them}${topic ? ` · ${topic}` : ""}`;
}

/** One duel's page: the player's side played, if it's theirs to play; any other duel (waiting for the friend, ended:
 * an old link to its result, a notification of it) is on its card in Приятели's „Дуели“, and the page goes there. */
export function duelOne(params: string[]) {
  title("Дуел");
  const id = Number(params[0]);
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  // What comes back once the screen is gone (another page opened meanwhile) does nothing.
  const life = lifetime();
  const tap = byTap();

  // How the duel stands: the player's side to play, or its card, in place of this page.
  const show = (d: DuelView) => (d.state === "yours" ? void ready(d) : go(cardHref(d.id), true));

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
      const now = (await api<{ duel: DuelView }>("POST", `/api/duels/${d.id}/play`, {})).duel;
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
  // far as the player has come). Its end lands on its card in Приятели's „Дуели“, first there, in place of this
  // page: the duel is settled by then (play: finished), sent to the friend or with its result, whose moment needs
  // the game's feel, asked for as the game starts.
  const play = (d: DuelView, s: State) => {
    loadFeel().catch(() => {});
    screen.show(() =>
      playRun(
        s,
        () => {
          go(cardHref(d.id), true);
          return h("p", { class: "muted" }, "…");
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
