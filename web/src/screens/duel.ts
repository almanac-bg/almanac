// Дуел: two players, the same ten questions. Your division and rating; a live duel with whoever comes (screens/
// live.ts), or „Предизвикай“: a game sent to friends and anyone, played in their own time (screens/challenge.ts); the
// challenges that are your turn, those waiting on friends, the challenges you sent (each a tap from its page: who took
// it, its link), and how the last duels went. One duel's screen plays the player's turn, or shows how it stands or
// ended (screens/outcome.ts, loaded on its own: kit.ts).

import { news } from "../game/news.ts";
import { nextSteps } from "../game/results.ts";
import { getReady, playRun, shownHere, startScreen } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { duelResult, loadDuelResult } from "../kit.ts";
import { type ApiError, api, errorText } from "../lib/api.ts";
import { type Child, effect, h, lifetime, signal, slot } from "../lib/dom.ts";
import { ordinal } from "../lib/ordinal.ts";
import { backOut, byTap, go, hold, title } from "../lib/router.ts";
import { withName } from "../lib/words.ts";
import { checkWaiting, player, topics, user } from "../state.ts";
import {
  back,
  type Division,
  failure,
  formatNumber,
  pageArt,
  type Standing,
  standingCard,
  type Tier,
  topicMark,
  until,
  who,
} from "../ui.ts";
import { nameFirst } from "./name.ts";
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

export interface DuelView {
  id: number;
  kind: "live" | "challenge";
  state: "play" | "wait" | "won" | "lost" | "draw" | "declined" | "expired";
  opponent?: Side;
  /** The other player's id, in a challenge between friends: to challenge them back. */
  friend?: number;
  you?: Side;
  recorded?: boolean;
  /** Didn't move ratings; `unrated` says why (play.DuelView). */
  friendly?: boolean;
  unrated?: "again" | "recordings" | "network" | "newcomers" | "known";
  delta?: number;
  runId?: number;
  createdAt: number;
  expiresAt: number;
  endedAt?: number;
  /** One duel's view says more of its result: the question (from 1) after which the winner led to the end (none: the
   * points were even), where the rating went, and the player's record against this opponent (a person). */
  decided?: number;
  /** Where the rating went; while it's still being set, how many rated games of how many it's from (no division). */
  rating?: { before: number; after: number; division: Division; next?: Division; rated?: number; of?: number };
  record?: { won: number; lost: number; drawn: number };
  /** A live duel one of the two left under way (it went on without them): how many questions they had played. */
  youLeft?: number;
  theyLeft?: number;
  /** The other, met in a live duel or by a challenge, may be asked to be friends (not a friend, nor asked). */
  befriend?: boolean;
  /** A challenge's: its code, and whether the player sent it (else they take it). */
  challenge?: string;
  sent?: boolean;
  /** With a win: the player's own link, for the win shared. */
  invite?: string;
}

/** One of the player's challenges (play.SentChallenge): its topic, their game's score, who took it and how it went for
 * the player, and until when it can be taken. */
interface Sent {
  code: string;
  topic?: string;
  points: number;
  rights: number;
  takers: number;
  won: number;
  lost: number;
  drawn: number;
  expiresAt: number;
  over?: boolean;
}

/** One of the player's duels, as its screen shows it. */
const oneDuel = async (id: number) => shown((await api<{ duel: DuelView }>("GET", `/api/duels/${id}`)).duel);

const words: Record<DuelView["state"], string> = {
  play: "Твой ред",
  wait: "Чака",
  won: "Победа",
  lost: "Загуба",
  draw: "Равенство",
  declined: "Отказано",
  expired: "Изтекло",
};

/** What a duel's state is called: a live duel without a result was cut off, not left to run out. */
const stateWord = (d: DuelView) => (d.state === "expired" && d.kind === "live" ? "Прекъснат" : words[d.state]);

/** A duel as a row: the other player, how it stands, and what to do. */
function duelRow(d: DuelView): Child {
  const them = d.opponent;
  const line =
    d.state === "wait"
      ? `до ${until(d.expiresAt)}` // whose turn it is: the name beside it
      : d.state === "play"
        ? d.you?.done === false && d.runId
          ? "Довърши играта си"
          : `${them?.name ?? "Някой"} те чака`
        : d.state === "declined" || d.state === "expired"
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
        h("strong", { class: "duel-state" }, stateWord(d)),
        h("span", { class: "muted" }, line),
        d.delta
          ? h("span", { class: d.delta > 0 ? "delta up" : "delta down" }, `${d.delta > 0 ? "+" : ""}${d.delta}`)
          : null,
      ),
    ),
  );
}

/** How the player's challenge went for them, once anyone has played it to the end: „водиш с 2 : 1“. */
function sentRecord(c: Sent): string {
  if (!c.won && !c.lost && !c.drawn) return "";
  const score = `${c.won} : ${c.lost}`;
  const lead = c.won > c.lost ? `водиш с ${score}` : c.won < c.lost ? `изоставаш с ${score}` : `равни сте ${score}`;
  return c.drawn ? `${lead} (и ${c.drawn} ${c.drawn === 1 ? "равенство" : "равенства"})` : lead;
}

/** One of the player's challenges as a row, a tap from its page (who took it, the link to send again): its topic,
 * how many took it and how it went, and until when it can be taken (or that it can't any more). */
function sentRow(c: Sent): Child {
  const name = c.topic ? (topics.find((t) => t.id === c.topic)?.name ?? "") : "Всички теми";
  const took = c.takers === 0 ? "Още никой" : c.takers === 1 ? "Изигра го 1" : `Изиграха го ${formatNumber(c.takers)}`;
  // Until when, by its day alone: the hour is on its page.
  const day = new Intl.DateTimeFormat("bg", { weekday: "long" }).format(new Date(c.expiresAt));
  return h(
    "li",
    null,
    h(
      "a",
      { class: "duel-row sent-row", href: `/c/${c.code}` },
      h(
        "span",
        { class: "who" },
        topicMark(c.topic ?? ""),
        h(
          "span",
          { class: "who-text" },
          h("span", { class: "who-name" }, h("span", { class: "who-label" }, name)),
          h("span", { class: "muted" }, [`${c.rights} от 10`, sentRecord(c)].filter(Boolean).join(" · ")),
        ),
      ),
      h(
        "span",
        { class: "duel-row-end" },
        h("strong", { class: "duel-state" }, took),
        h("span", { class: "muted" }, c.over ? "Изтече" : `до ${day}`),
      ),
    ),
  );
}

export function duel() {
  title("Дуел");
  const data = signal<{ duels: DuelView[]; standing: Standing; challenges?: Sent[] } | null>(null);
  if (user.peek())
    api<{ duels: DuelView[]; standing: Standing; challenges?: Sent[] }>("GET", "/api/duels").then(
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
    nextSteps(
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
      // In their own time: a game sent to friends, and to anyone by its link.
      [h("a", { class: "btn", href: "/challenge" }, "Предизвикай")],
    ),
    // The division once a duel has moved the rating (play/unfold.go): before that it says nothing.
    () => {
      const d = data();
      return d?.standing.rated ? standingCard(d.standing, true) : null;
    },
    () => {
      const list = data()?.duels ?? [];
      const sent = data()?.challenges ?? [];
      const turn = list.filter((d) => d.state === "play");
      const waiting = list.filter((d) => d.state === "wait");
      const open = sent.filter((c) => !c.over);
      // What's over, the latest first: the duels by when they ended, the challenges by when their time ran out.
      const done = [
        ...list.filter((d) => d.endedAt).map((d) => ({ at: d.endedAt ?? 0, row: duelRow(d) })),
        ...sent.filter((c) => c.over).map((c) => ({ at: c.expiresAt, row: sentRow(c) })),
      ]
        .sort((a, b) => b.at - a.at)
        .slice(0, 20);
      return [
        turn.length ? section("Твой ред", turn.map(duelRow)) : null,
        waiting.length ? section("Ред на другите", waiting.map(duelRow)) : null,
        open.length ? section("Твоите предизвикателства", open.map(sentRow)) : null,
        done.length
          ? section(
              "История",
              done.map((d) => d.row),
            )
          : null,
      ];
    },
  );
}

function section(heading: string, rows: Child[]): Child {
  return h(
    "section",
    { class: "stack" },
    h("h2", { class: "section-title" }, heading),
    h("ul", { class: "duel-list" }, rows),
  );
}

/** A challenge the player has said yes to elsewhere (the notice): its screen plays it at once, without asking again. */
let accepted = 0;

/** Plays a friend's challenge now: its screen, straight into the game. */
export function playChallenge(id: number): void {
  accepted = id;
  go(`/duel/${id}`);
}

/** A friend's game of the player's challenge, played, as Начало hears of it. */
export interface FriendPlayed {
  id: number;
  from: string;
  state: "won" | "lost" | "draw";
  you: number;
  them: number;
}

/** Where the latest duel told on Начало (or seen on its screen) is kept, on this device. */
const toldKey = "almanac.duelTold";

/** Keeps a duel's result as told; whether it wasn't before. */
function told(id: number): boolean {
  try {
    if (Number(localStorage.getItem(toldKey)) >= id) return false;
    localStorage.setItem(toldKey, String(id));
  } catch {
    // Storage refused (a private window): told on each visit, the lesser loss.
  }
  return true;
}

/** A friend has played the player's challenge: said once, above the day, a tap from the result. */
export function playedLine(p?: FriendPlayed | null): Child {
  if (!p || !told(p.id)) return null;
  return h(
    "p",
    { class: "streak-notice", role: "status" },
    `${p.from} изигра предизвикателството ти: ${p.state === "won" ? "ти печелиш" : p.state === "lost" ? `победата е за ${p.from}` : "равенство"}, ${formatNumber(p.you)} : ${formatNumber(p.them)}.`,
    h("a", { href: `/duel/${p.id}` }, "Виж"),
  );
}

/** A friend's yes to the player's invite, as Начало hears of it (play.AcceptedOf). */
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

/** A friend said yes to the player's invite: said once, above the day, a tap from challenging them. */
export function acceptedLine(a?: Accepted | null): Child {
  if (!a || !toldOnce(a.line)) return null;
  return h(
    "p",
    { class: "streak-notice", role: "status" },
    `${a.name} прие поканата ти.`,
    h("a", { href: `/challenge/${a.id}` }, "Предизвикай"),
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

/** Who took the player's challenges since they last heard: how many, how many of them won, the latest's code. */
export interface ChallengeNews {
  played: number;
  beat: number;
  name?: string;
  code: string;
}

/** Who took the player's challenges: one line for all of them, once, a tap from who took the latest. */
export function challengesLine(n?: ChallengeNews | null): Child {
  // The same news drawn again isn't told twice; newer news (Начало loaded again) is.
  if (!n || !toldOnce("challenges", n)) return null;
  const beat =
    n.beat === 0
      ? ""
      : n.played === 1
        ? " и те би"
        : n.beat === 1
          ? ", един от тях те би"
          : `, ${n.beat} от тях те биха`;
  const who = n.played === 1 ? `${n.name || "Един човек"} изигра` : `${n.played} души изиграха`;
  return h(
    "p",
    { class: "streak-notice", role: "status" },
    `${who} предизвикателството ти${beat}.`,
    h("a", { href: `/c/${n.code}` }, "Виж"),
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
      h("h1", null, "Дуелът те чака в профила ти"),
      h("p", { class: "lead" }, "Влез с имейла на профила си и го изиграй тук."),
    ),
    h("section", { class: "card" }, signIn()),
  );
}

/** One duel: played now if it's the player's turn (a challenge to take, or their own game of one they sent, left
 * half-way), else how it stands or ended. */
export function duelOne(params: string[]) {
  title("Дуел");
  const id = Number(params[0]);
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  const tap = byTap();
  // What comes back once the screen is gone (another page opened meanwhile) does nothing: a game's entry held over
  // that page, or a game started on it, would be another page's.
  const life = lifetime();
  const load = async () => {
    try {
      const d = await oneDuel(id);
      if (life.aborted) return;
      const play = async () => {
        loadDuelResult().catch(() => {}); // the result's screen, on its way while the player plays
        const s = d.runId
          ? await api<State>("GET", `/api/runs/${d.runId}`)
          : (await api<{ duel: number; state?: State }>("POST", `/api/challenges/${d.challenge}/play`, {})).state;
        if (life.aborted) return;
        checkWaiting(); // the notice goes
        if (!s) return void load(); // over meanwhile (its time ran out): how it ended
        screen.show(() => playRun(s, (end) => afterDuel(id, end.id), d.opponent?.name));
      };
      const failed = (err: unknown) => {
        if (!life.aborted) screen.show(() => failure(err, () => void load(), ["/duel", "Към дуелите"]));
      };
      // Sent to the player and not started: who asks, and the choice (unless said yes to already). Taken, the one who
      // sent it sees who took it: a name of the player's own first, if they still have the one drawn for them.
      const yes = accepted === id;
      accepted = 0;
      const named = async () => (await nameFirst()) && !life.aborted;
      if (d.state === "play" && !d.runId && !yes)
        return screen.show(() =>
          asked(
            d,
            async () => {
              if (await named()) await play();
            },
            () => screen.show(() => duelResult({ ...d, state: "declined" })),
          ),
        );
      // Said yes from the notice, not started yet: the count-in first, with a way back (the challenge stays).
      if (d.state === "play" && !d.runId) {
        if (!(await named())) return;
        hold();
        return screen.show(() =>
          getReady(
            duelWith(d.opponent?.name),
            () => void play().catch(failed),
            () => backOut("/duel", () => void load()),
          ),
        );
      }
      // Started: straight back in after a tap, or where this tab was showing its question (a reload); come to
      // otherwise (another device, back or forward), it waits for „Продължи“.
      if (d.state === "play" && d.runId) {
        const s = await api<State>("GET", `/api/runs/${d.runId}`);
        if (life.aborted) return;
        if (yes || tap || (s.question && shownHere(s.id))) return play().catch(failed);
        return screen.show(() =>
          startScreen(
            duelWith(d.opponent?.name),
            "",
            { at: s.at, total: s.total, marks: s.trail },
            () => void play().catch(failed),
          ),
        );
      }
      checkWaiting(); // a notice that pointed here, to a duel already played, goes
      told(d.id); // and Начало needn't say that the friend played it
      screen.show(() => duelResult(d));
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

/** A friend's challenge sent to the player: who asks, and play it or say no. */
function asked(d: DuelView, play: () => Promise<void>, declined: () => void): Child {
  const error = signal("");
  const them = d.opponent?.name ?? "Някой";
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Предизвикателство"),
      h("h1", null, `${them} те предизвика`),
      h("p", { class: "lead" }, `Десет въпроса, около три минути. Имаш време до ${until(d.expiresAt)}`),
    ),
    h(
      "button",
      {
        class: "btn primary big",
        type: "button",
        onclick: () => play().catch((err) => error.set(errorText(err))),
      },
      "Играй",
    ),
    h(
      "button",
      {
        class: "btn",
        type: "button",
        onclick: async () => {
          try {
            await api("DELETE", `/api/duels/${d.id}`);
            checkWaiting();
            declined();
          } catch (err) {
            error.set(errorText(err));
          }
        },
      },
      "Откажи",
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

/** Right after the player's run (`run`): the duel's result if the other has played too, else that it waits; and what
 * the game earned. */
export function afterDuel(id: number, run: number): Child {
  const view = signal<DuelView | null>(null);
  const error = signal("");
  oneDuel(id).then(view.set, (err) => error.set(errorText(err)));
  return h("div", null, () => {
    const d = view();
    if (d) return duelResult(d, null, news(run));
    return error() ? h("p", { class: "bad", role: "alert" }, error()) : h("p", { class: "muted" }, "…");
  });
}

/** „Дуел със Заек“, or just „Дуел“ without a name. */
const duelWith = (name?: string) => (name ? `Дуел ${withName(name)}` : "Дуел");
