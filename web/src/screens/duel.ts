// Дуел: two friends on the same ten questions, each on their own time (play/duels.go): the player plays first, and the
// friend, told, plays the same ten when they can (seven days); whoever plays second sees both at once. A duel is played
// as any game is (game/run.ts), with the other's answers beside the player's once they've given theirs. It starts from
// „Дуел“ on a friend's row in Приятели or on their profile (startDuel), the only ways; one duel's page (/duel/<id>) is
// where it's played, and nothing else: everything about a duel is on its card in Приятели (screens/duelcards.ts),
// where its game's end lands, and where the page of a duel not the player's to play goes (an old link to its result,
// a notification of it).

import { getReady, playRun, shownHere, starting, startScreen } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { type ApiError, api, errorText } from "../lib/api.ts";
import { type Child, effect, h, lifetime, slot } from "../lib/dom.ts";
import { backOut, byTap, go, hold, title } from "../lib/router.ts";
import { withWord } from "../lib/words.ts";
import { player, user } from "../state.ts";
import { avatar, failure, type Look } from "../ui.ts";
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

/** The player's duels, as Приятели lists them (play.Duels). */
export interface Duels {
  yours: DuelView[];
  theirs: DuelView[];
  played: DuelView[];
  /** How many the player has played in all (the list holds the last ten: the rest a page at a time, play.DuelsPlayed). */
  playedAll: number;
}

/** A page of the player's duels played (play.PlayedPage). */
export interface PlayedPage {
  duels: DuelView[];
  page: number;
  pages: number;
}

/** One of the player's duels. */
const oneDuel = async (id: number) => (await api<{ duel: DuelView }>("GET", `/api/duels/${id}`)).duel;

/** Starts a duel with a friend (by their id); the player made first if need be, and asked for a name of their own if
 * they still have the one drawn for them (the friend sees it). It says the duel. */
export async function startDuel(friend: number): Promise<DuelView | null> {
  await player();
  if (!(await nameFirst())) return null;
  return (await api<{ duel: DuelView }>("POST", "/api/duels", { friend })).duel;
}

/** Where a duel's card is, in Приятели: the duel named in the address comes first in its group there. */
const cardHref = (id: number) => `/friends?duel=${id}`;

/** A friend's yes to the player's request, as Приятели hears of it (play.AcceptedOf). */
export interface Accepted {
  id: number;
  name: string;
}

/** The friends whose yes was told on this page already: Приятели drawn again doesn't say it twice. */
const toldHere = new Set<number>();

/** Tells a friend's yes once, wherever the player is signed in (the server keeps it as told, play.ToldAccepted):
 * whether it's news here. */
function toldOnce(friend: number): boolean {
  if (toldHere.has(friend)) return false;
  toldHere.add(friend);
  api("POST", `/api/friends/${friend}/told`).catch(() => {});
  return true;
}

/** A friend said yes to the player's request: said once, in Приятели, over the friends. */
export function acceptedLine(a?: Accepted | null): Child {
  if (!a || !toldOnce(a.id)) return null;
  return h("p", { class: "notice accepted-notice", role: "status" }, `${a.name} прие поканата ти за приятелство.`);
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

/** What a duel is called over its game: „Дуел с Мария“. */
const duelName = (d: DuelView): string => `Дуел ${withWord(d.opponent?.name ?? "")}`;

/** One duel's page: the player's side played, if it's theirs to play; any other duel (waiting for the friend, ended:
 * an old link to its result, a notification of it) is on its card in Приятели, and the page goes there. */
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
    const lead = d.first
      ? `Десет въпроса. После ${d.opponent?.name ?? "приятелят ти"} ще изиграе същите.`
      : `Същите десет въпроса, които изигра ${d.opponent?.name ?? "приятелят ти"}. След всеки отговор виждаш отговора на ${d.opponent?.name ?? "приятеля ти"}.`;
    // On a card, the two face to face over its words, as a chapter's game has its glyph.
    const faces = h(
      "span",
      { class: "start-faces", "aria-hidden": "true" },
      avatar(d.you?.look?.avatar, { size: "l", name: d.you?.name ?? "" }),
      avatar(d.opponent?.look?.avatar, { size: "l", name: d.opponent?.name ?? "" }),
    );
    screen.show(() =>
      startScreen(
        name,
        lead,
        s?.at ? { at: s.at, total: s.total, marks: s.trail, leftMs: s.question?.leftMs } : null,
        () => (s?.at ? void start(d) : begin()),
        undefined,
        "",
        faces,
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
  // far as the player has come). Its end lands on its card in Приятели, first in its group, in place of this
  // page: the duel is settled by then (play: finished), sent to the friend or with its result.
  // Приятели (the friends, the duels) is asked for as the last answer shows, so that the game's end lands there in
  // one draw, from them (api.ts, lastOf), never a blank page between.
  const play = (d: DuelView, s: State) => {
    let ahead: Promise<unknown> | null = null;
    const askAhead = () => {
      ahead ??= Promise.all([api("GET", "/api/friends"), api("GET", "/api/duels")]).catch(() => null);
      return ahead;
    };
    screen.show(() =>
      playRun(
        s,
        () => {
          askAhead().then(() => {
            if (!life.aborted) go(cardHref(d.id), true);
          });
          return h("p", { class: "muted" }, "…");
        },
        duelName(d),
        d.opponent?.name ?? "",
        () => void askAhead(),
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
