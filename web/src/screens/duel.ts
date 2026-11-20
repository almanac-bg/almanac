// Дуел: two players live, the same ten questions at the same moment (screens/live.ts), with whoever comes, or a
// recording of a real game if nobody does. Your division and rating, and how the last duels went. One duel's screen
// shows how it ended (screens/outcome.ts, loaded on its own: kit.ts).

import { duelResult } from "../kit.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, effect, h, lifetime, signal, slot } from "../lib/dom.ts";
import { ordinal } from "../lib/ordinal.ts";
import { go, title } from "../lib/router.ts";
import { withName } from "../lib/words.ts";
import { player, user } from "../state.ts";
import {
  back,
  type Division,
  failure,
  formatNumber,
  pageArt,
  type Standing,
  standingCard,
  type Tier,
  who,
} from "../ui.ts";
import { signIn } from "./signin.ts";

/** How one question of a duel went for one side: its points, right or partly (some points, not right), how long it
 * took, and whether nothing was given. */
export interface DuelMark {
  points: number;
  right: boolean;
  partial?: boolean;
  ms: number;
  missed?: boolean;
}

export interface Side {
  name: string;
  tag?: string;
  points: number;
  rights: number;
  ms: number;
  done: boolean;
  look?: { avatar?: string; title?: string; titleTier?: Tier; level?: number };
  /** A player who has gone since (play.DuelSide.Gone): their game went with them, so their score isn't known. */
  gone?: boolean;
  /** How each question went (one duel's view): the player's own as they play, the other's once there's a result. */
  marks?: DuelMark[];
}

/** A duel as its screens show it: a player gone since shows as nobody's, a plain tile without an animal (no avatar of
 * theirs, nor one drawn from a name that isn't theirs). */
const shown = (d: DuelView): DuelView =>
  d.opponent?.gone ? { ...d, opponent: { ...d.opponent, look: { avatar: "-gone" } } } : d;

/** A live duel that has ended: won, lost, drawn, or (expired) cut off without a result. */
export interface DuelView {
  id: number;
  state: "won" | "lost" | "draw" | "expired";
  opponent?: Side;
  you?: Side;
  recorded?: boolean;
  /** Didn't move ratings; `unrated` says why (play.DuelView). */
  friendly?: boolean;
  unrated?: "again" | "recordings" | "network" | "newcomers";
  delta?: number;
  runId?: number;
  createdAt: number;
  endedAt: number;
  /** One duel's view says more of its result: the question (from 1) after which the winner led to the end (none: the
   * points were even), where the rating went, and the player's record against this opponent (a person). */
  decided?: number;
  /** Where the rating went; while it's still being set, how many rated games of how many it's from (no division). */
  rating?: { before: number; after: number; division: Division; next?: Division; rated?: number; of?: number };
  record?: { won: number; lost: number; drawn: number };
  /** A live duel one of the two left under way (it went on without them): how many questions they had played. */
  youLeft?: number;
  theyLeft?: number;
  /** The other, met in a live duel, may be asked to be friends (not a friend, nor asked). */
  befriend?: boolean;
}

/** One of the player's duels, as its screen shows it. */
const oneDuel = async (id: number) => shown((await api<{ duel: DuelView }>("GET", `/api/duels/${id}`)).duel);

/** What a duel's end is called: one without a result was cut off. */
const words: Record<DuelView["state"], string> = {
  won: "Победа",
  lost: "Загуба",
  draw: "Равенство",
  expired: "Прекъснат",
};

/** A duel as a row: the other player, how it ended, and the rating it moved. */
function duelRow(d: DuelView): Child {
  const them = d.opponent;
  const line =
    d.state === "expired"
      ? "Без резултат"
      : them?.gone
        ? "Играчът вече го няма" // their game went with them: no score of theirs to set beside the player's
        : `${formatNumber(d.you?.points ?? 0)} : ${formatNumber(them?.points ?? 0)}${d.recorded ? " · срещу запис" : ""}${d.friendly ? " · без рейтинг" : ""}`;
  return h(
    "li",
    null,
    h(
      "a",
      { class: `duel-row s-${d.state}`, href: `/duel/${d.id}` },
      them ? who(them.name, them.look ?? {}, null, them.name) : h("span", { class: "who-name" }, "Съперник"),
      h(
        "span",
        { class: "duel-row-end" },
        h("strong", { class: "duel-state" }, words[d.state]),
        h("span", { class: "muted" }, line),
        d.delta
          ? h(
              "span",
              { class: d.delta > 0 ? "delta up" : "delta down" },
              `${d.delta > 0 ? "+" : ""}${formatNumber(d.delta)}`,
            )
          : null,
      ),
    ),
  );
}

export function duel() {
  title("Дуел");
  const data = signal<{ duels: DuelView[]; standing: Standing } | null>(null);
  if (user.peek())
    api<{ duels: DuelView[]; standing: Standing }>("GET", "/api/duels").then(
      (r) => data.set({ ...r, duels: r.duels.map(shown) }),
      () => {},
    );
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      back("/", "Начало"),
      pageArt("duel", "tone-rose"),
      h("h1", null, "Дуел"),
      h("p", { class: "lead" }, "Ти и друг играч на живо: едни и същи десет въпроса, в един и същ миг."),
    ),
    h(
      "button",
      {
        class: "btn primary big",
        type: "button",
        onclick: async () => {
          await player();
          go("/duel/live");
        },
      },
      "Намери съперник",
    ),
    // The division once a duel has moved the rating (play/unfold.go): before that it says nothing.
    () => {
      const d = data();
      return d?.standing.rated ? standingCard(d.standing, true) : null;
    },
    () => {
      // The latest first.
      const done = (data()?.duels ?? []).toSorted((a, b) => b.endedAt - a.endedAt).slice(0, 20);
      return done.length
        ? h(
            "section",
            { class: "stack" },
            h("h2", { class: "section-title" }, "История"),
            h("ul", { class: "duel-list" }, done.map(duelRow)),
          )
        : null;
    },
  );
}

/** A friend's yes to the player's request, as Начало hears of it (play.AcceptedOf). */
export interface Accepted {
  id: number;
  name: string;
  line: string;
}

/** A live duel the player left under way, and what came of it (play.LeftOf). */
export interface Left {
  id: number;
  them: string;
  after: number;
  state: "won" | "lost" | "draw";
  delta?: number;
  line: string;
}

/** Lines told on this page already: Начало drawn again (after a game) doesn't say them twice. */
const toldHere = new Set<unknown>();

/** Tells a line once, wherever the player is signed in (the server keeps it as told): whether it's news here. `news`
 * is what's told, where the line's id is the same for all of it (its own, if it has one). */
function toldOnce(line: string, news: unknown = line): boolean {
  if (toldHere.has(news)) return false;
  toldHere.add(news);
  api("POST", "/api/told", { line }).catch(() => {});
  return true;
}

/** A friend said yes to the player's request: said once, above the day, a tap from the friends. */
export function acceptedLine(a?: Accepted | null): Child {
  if (!a || !toldOnce(a.line)) return null;
  return h(
    "p",
    { class: "streak-notice", role: "status" },
    `${a.name} прие поканата ти за приятелство.`,
    h("a", { href: "/friends" }, "Приятели"),
  );
}

/** After which question one left, in words: „след 4-тия въпрос“, or „още на първия въпрос“. */
const leftAfter = (n: number) => (n > 0 ? `след ${ordinal(n)}я въпрос` : "още на първия въпрос");

/** A live duel the player left went on without them: what came of it, said once, a tap from the result. */
export function leftLine(l?: Left | null): Child {
  if (!l || !toldOnce(l.line)) return null;
  const rating = l.delta ? `, рейтинг ${l.delta > 0 ? "+" : "−"}${Math.abs(l.delta)}` : "";
  return h(
    "p",
    { class: "streak-notice", role: "status" },
    `Дуелът ${withName(l.them)} продължи без теб (излезе ${leftAfter(l.after)}): ${words[l.state].toLowerCase()}${rating}.`,
    h("a", { href: `/duel/${l.id}` }, "Виж"),
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
        h("h1", null, "Този дуел не е тук"),
        h("p", { class: "lead" }, "Или е на друг профил, или вече го няма."),
      ),
      h("a", { class: "btn primary big", href: "/duel" }, "Към дуелите"),
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
    h("section", { class: "card" }, signIn()),
  );
}

/** One duel: how it ended. */
export function duelOne(params: string[]) {
  title("Дуел");
  const id = Number(params[0]);
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  // What comes back once the screen is gone (another page opened meanwhile) does nothing.
  const life = lifetime();
  const load = async () => {
    try {
      const d = await oneDuel(id);
      if (!life.aborted) screen.show(() => duelResult(d));
    } catch (err) {
      if (life.aborted) return;
      const code = (err as ApiError).code;
      if (code === "signed_out" || code === "no_duel") return screen.show(() => notHere(() => void load()));
      screen.show(() => failure(err, () => void load(), ["/duel", "Към дуелите"]));
    }
  };
  load();
  return h("div", null, screen);
}
