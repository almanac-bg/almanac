// Дуел: two players on the same ten questions, each on their own time (play/duels.go). With a friend: the player plays
// first, and the friend, told, plays the same ten when they can (three days); whoever plays second sees both at once.
// Or against a recording: a real player's finished game, its answers shown as they came. A duel is played as any
// game is (game/run.ts), with the other's answers beside the player's once they've given theirs. Приятели lists the
// duels (duelLists: theirs to play, waiting, played); „Нов дуел“ (/duel/new) starts one; one duel's page (/duel/<id>)
// plays it, or shows how it ended (screens/outcome.ts, loaded on its own: kit.ts).

import { news } from "../game/news.ts";
import { summary } from "../game/results.ts";
import { getReady, playRun, shownHere, starting, startScreen } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { duelResult } from "../kit.ts";
import { type ApiError, api, errorText } from "../lib/api.ts";
import { type Child, effect, h, lifetime, signal, slot } from "../lib/dom.ts";
import { backOut, byTap, go, hold, title } from "../lib/router.ts";
import { withWord } from "../lib/words.ts";
import { player, topics, user } from "../state.ts";
import { back, failure, formatNumber, pageArt, who } from "../ui.ts";
import { missing } from "./missing.ts";
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
  look?: { avatar?: string };
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
  /** One duel's view: the question (from 1) after which the winner led to the end (none: the points were even). */
  decided?: number;
  record?: { won: number; lost: number; drawn: number };
  /** The other is a friend now (`them`, their id): a rematch is a tap away. */
  friend?: boolean;
  them?: number;
}

/** The player's duels, as Приятели lists them (play.Duels). */
export interface Duels {
  yours: DuelView[];
  theirs: DuelView[];
  played: DuelView[];
}

/** A duel as its screens show it: a player gone since shows as nobody's, a plain tile without an animal (no avatar of
 * theirs, nor one drawn from a name that isn't theirs). */
const shown = (d: DuelView): DuelView =>
  d.opponent?.gone ? { ...d, opponent: { ...d.opponent, look: { avatar: "-gone" } } } : d;

/** One of the player's duels, as its screen shows it. */
const oneDuel = async (id: number) => shown((await api<{ duel: DuelView }>("GET", `/api/duels/${id}`)).duel);

/** Starts a duel: with a friend (by their id), or against a recording; the player made first if need be, and asked
 * for a name of their own if they still have the one drawn for them (a friend sees it). It says the duel. */
export async function startDuel(to: { friend: number } | { recording: true }): Promise<DuelView | null> {
  await player();
  if ("friend" in to && !(await nameFirst())) return null;
  return shown((await api<{ duel: DuelView }>("POST", "/api/duels", to)).duel);
}

/** How long an open duel has left, in words: „още 2 дни“, „още 5 часа“, „под час“. */
export function leftWords(until: number, now = Date.now()): string {
  const hours = Math.floor((until - now) / 3_600_000);
  if (hours >= 48) return `още ${Math.floor(hours / 24)} дни`;
  if (hours >= 24) return "още 1 ден";
  if (hours >= 2) return `още ${hours} часа`;
  if (hours === 1) return "още 1 час";
  return "под час";
}

/** What a duel's end is called. */
const ends: Record<DuelView["state"], string> = {
  yours: "Твой ред",
  theirs: "Чака",
  won: "Победа",
  lost: "Загуба",
  draw: "Равенство",
  expired: "Изтече",
};

/** The pair's record, the way a row says it: „общо 5 на 3“. */
const recordLine = (r?: DuelView["record"]) =>
  r && r.won + r.lost + r.drawn > 1 ? ` · общо ${r.won} на ${r.lost}${r.drawn ? `, ${r.drawn} равни` : ""}` : "";

/** What a row says under a duel's end. */
function rowLine(d: DuelView): string {
  const them = d.opponent;
  const versus = d.recorded ? " · срещу запис" : "";
  switch (d.state) {
    case "yours":
      return d.first
        ? `Довърши своята игра · ${leftWords(d.until ?? 0)}`
        : `Изиграй същите десет · ${leftWords(d.until ?? 0)}`;
    case "theirs":
      return `Не е изигран · ${leftWords(d.until ?? 0)}`;
    case "expired":
      if (d.lapsed === "they") return `${them?.name ?? "Приятелят"} не го изигра навреме`;
      if (d.lapsed === "you") return "Не го изигра навреме";
      return "Без резултат";
  }
  if (them?.gone) return "Играчът вече го няма"; // their game went with them: no score of theirs to set beside the player's
  return `${formatNumber(d.you?.points ?? 0)} : ${formatNumber(them?.points ?? 0)}${versus}${recordLine(d.record)}`;
}

/** A duel as a row: the other player, where it stands, and a word on it. */
export function duelRow(d: DuelView): Child {
  const them = d.opponent;
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
        h("strong", { class: "duel-state" }, ends[d.state]),
        h("span", { class: "muted" }, rowLine(d)),
      ),
    ),
  );
}

/** How many played duels Приятели lists. */
const playedShown = 5;

/** The player's duels in Приятели: theirs to play first, then those waiting for a friend, then those played. */
export function duelLists(d: Duels): Child {
  const part = (heading: string, list: DuelView[]) =>
    list.length
      ? h(
          "section",
          { class: "stack small-gap" },
          h("h2", { class: "section-title" }, heading),
          h("ul", { class: "duel-list" }, list.map(shown).map(duelRow)),
        )
      : null;
  return [part("Твой ред", d.yours), part("Чакаш", d.theirs), part("Изиграни", d.played.slice(0, playedShown))];
}

/** A friend's duel that waits for the player, as Начало says it (play.DuelWaiting): one quiet line, while it waits. */
export interface Waiting {
  id: number;
  name: string;
  n: number;
}

/** Начало's line: a friend's duel waits for the player. */
export function waitingLine(w?: Waiting | null): Child {
  if (!w) return null;
  return h(
    "p",
    { class: "streak-notice", role: "status" },
    w.n > 1 ? `${w.n} дуела те чакат.` : `${w.name} те покани на дуел.`,
    w.n > 1 ? h("a", { href: "/friends" }, "Приятели") : h("a", { href: `/duel/${w.id}` }, "Играй"),
  );
}

/** A friend's yes to the player's request, as Начало hears of it (play.AcceptedOf). */
export interface Accepted {
  id: number;
  name: string;
  line: string;
}

/** Lines told on this page already: Начало drawn again (after a game) doesn't say them twice. */
const toldHere = new Set<unknown>();

/** Tells a line once, wherever the player is signed in (the server keeps it as told): whether it's news here. */
function toldOnce(line: string): boolean {
  if (toldHere.has(line)) return false;
  toldHere.add(line);
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

interface Friend {
  id: number;
  name: string;
  tag: string;
  avatar?: string;
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
  const begin = async (to: { friend: number } | { recording: true }) => {
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
      pageArt("duel", "tone-rose"),
      h("h1", null, "Нов дуел"),
      h("p", { class: "lead" }, "Десет въпроса. Изиграй ги сега, а другият ги играе, когато може."),
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
        { class: "duel-list" },
        list.map((f) =>
          h(
            "li",
            null,
            h(
              "button",
              {
                class: "duel-row duel-pick",
                type: "button",
                disabled: busy,
                "aria-label": `Дуел ${withWord(f.name)}`,
                onclick: () => begin({ friend: f.id }),
              },
              who(f.name, { avatar: f.avatar }, null, f.name),
              h("span", { class: "duel-row-end" }, h("strong", { class: "duel-state duel-invite" }, "Покани")),
            ),
          ),
        ),
      );
    }),
    h(
      "section",
      { class: "stack small-gap" },
      h("h2", { class: "section-title" }, "Срещу запис"),
      h(
        "p",
        { class: "muted" },
        "Същите десет въпроса като в истинска игра на друг играч, с отговорите в нея, както са дадени.",
      ),
      h(
        "button",
        { class: "btn", type: "button", disabled: busy, onclick: () => begin({ recording: true }) },
        "Играй срещу запис",
      ),
    ),
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
        h("h1", null, "Този дуел не е тук"),
        h("p", { class: "lead" }, "Или е на друг профил, или вече го няма."),
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
    h("section", { class: "card" }, signIn()),
  );
}

/** What a duel is called over its game: „Дуел с Мария“, „Срещу запис на Мария“ (of a topic's game: „… · История“). */
function duelName(d: DuelView): string {
  const them = d.opponent?.name ?? "";
  if (!d.recorded) return `Дуел ${withWord(them)}`;
  const topic = d.topic ? topics.find((t) => t.id === d.topic)?.name : "";
  return `Срещу запис на ${them}${topic ? ` · ${topic}` : ""}`;
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
          `Изпратен. ${them} ще изиграе същите десет въпроса: има време ${leftWords(d.until ?? Date.now() + 3 * 86_400_000)}. Ще видиш резултата, щом играе.`,
        ),
      ],
      {
        main: h("a", { class: "btn primary big", href: "/friends" }, "Към Приятели"),
        also: [h("a", { class: "btn", href: "/duel/new" }, "Нов дуел")],
      },
      [just ? news(s.id) : null],
      undefined,
      just,
    ),
  );
}

/** A gold button that starts another duel (a rematch, the other way round; another recording), and says so if it
 * can't (a limit reached). */
function again(label: string, to: { friend: number } | { recording: true }): Child {
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
          ? again("Още един срещу запис", { recording: true })
          : null;
    screen.show(() =>
      duelResult(
        d,
        { main: next ?? toFriends(true), also: next ? [toFriends(false)] : [] },
        just && d.runId ? news(d.runId) : null,
      ),
    );
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
      ? `Десет въпроса като в истинската игра на ${d.opponent?.name ?? "друг играч"}. След всеки отговор виждаш как е минал въпросът в записа.`
      : d.first
        ? `Десет въпроса. После ${d.opponent?.name ?? "приятелят ти"} ще изиграе същите.`
        : `Същите десет въпроса като на ${d.opponent?.name ?? "приятеля ти"}. След всеки отговор виждаш как е минал въпросът за ${d.opponent?.name ?? "приятеля ти"}.`;
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
        d.recorded ? `запис на ${d.opponent?.name ?? ""}` : (d.opponent?.name ?? ""),
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
