// Дуел: two players, the same ten questions. Your division and rating; a live duel with whoever comes (screens/
// live.ts), or a friend challenged to play in their own time; the challenges that are your turn, those waiting on
// friends, and how the last duels went. One duel's screen plays the player's turn, or shows how it stands or ended
// (screens/outcome.ts, loaded on its own: kit.ts).

import { news } from "../game/news.ts";
import { getReady, playRun } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { duelResult, loadDuelResult } from "../kit.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal, slot } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { withName } from "../lib/words.ts";
import { checkWaiting, player, user } from "../state.ts";
import {
  back,
  type Division,
  formatNumber,
  pageArt,
  type Standing,
  standingCard,
  type Tier,
  until,
  who,
} from "../ui.ts";

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
  /** How each question went (one duel's view): the player's own as they play, the other's once there's a result. */
  marks?: DuelMark[];
}

export interface DuelView {
  id: number;
  kind: "live" | "friend";
  state: "play" | "wait" | "won" | "lost" | "draw" | "declined" | "expired";
  opponent?: Side;
  /** The other player's id, in a friend's duel: for a rematch. */
  friend?: number;
  you?: Side;
  recorded?: boolean;
  /** Didn't move ratings: the two had a rated duel that day already. */
  friendly?: boolean;
  delta?: number;
  runId?: number;
  createdAt: number;
  expiresAt: number;
  endedAt?: number;
  /** One duel's view says more of its result: the question (from 1) after which the winner led to the end (none: the
   * points were even), where the rating went, and the player's record against this opponent (a person). */
  decided?: number;
  rating?: { before: number; after: number; division: Division; next?: Division };
  record?: { won: number; lost: number; drawn: number };
}

interface Friend {
  id: number;
  name: string;
  tag: string;
}

/** One of the player's duels, as its screen shows it. */
const oneDuel = async (id: number) => (await api<{ duel: DuelView }>("GET", `/api/duels/${id}`)).duel;

const words: Record<DuelView["state"], string> = {
  play: "Твой ред",
  wait: "Чака",
  won: "Победа",
  lost: "Загуба",
  draw: "Равенство",
  declined: "Отказан",
  expired: "Без отговор",
};

/** What a duel's state is called: a live duel without a result was cut off, not left to run out. */
const stateWord = (d: DuelView) => (d.state === "expired" && d.kind === "live" ? "Прекъснат" : words[d.state]);

/** A duel as a row: the other player, how it stands, and what to do. */
function duelRow(d: DuelView): Child {
  const them = d.opponent;
  const line =
    d.state === "wait"
      ? `${them ? them.name : "съперник"} · до ${until(d.expiresAt)}`
      : d.state === "play"
        ? d.you?.done === false && d.runId
          ? "Довърши играта си"
          : `${them?.name ?? "Някой"} те чака`
        : d.state === "declined" || d.state === "expired"
          ? "Без резултат"
          : `${formatNumber(d.you?.points ?? 0)} : ${formatNumber(them?.points ?? 0)}${d.recorded ? " · срещу запис" : ""}${d.friendly ? " · приятелски" : ""}`;
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

export function duel() {
  title("Дуел");
  const data = signal<{ duels: DuelView[]; standing: Standing } | null>(null);
  const friends = signal<Friend[]>([]);
  const screen = slot();
  const error = signal("");
  if (user.peek()) {
    api<{ duels: DuelView[]; standing: Standing }>("GET", "/api/duels").then(data.set, () => {});
    api<{ friends: Friend[] }>("GET", "/api/friends").then(
      (f) => friends.set(f.friends),
      () => {},
    );
  }
  const challenge = async (friend: Friend) => go(`/duel/friend/${friend.id}`);
  const hub = h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      back("/", "Начало"),
      pageArt("duel", "tone-rose"),
      h("h1", null, "Дуел"),
      h(
        "p",
        { class: "lead" },
        "Ти и друг играч, на живо: едни и същи десет въпроса, в един и същи миг. Ако до 10 секунди не дойде никой, играеш срещу запис на истинска игра на играч като теб.",
      ),
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
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
    // The division once a duel has moved the rating (play/unfold.go): before that it says nothing.
    () => {
      const d = data();
      return d?.standing.rated ? standingCard(d.standing, true) : null;
    },
    () => {
      const list = data()?.duels ?? [];
      const turn = list.filter((d) => d.state === "play");
      const waiting = list.filter((d) => d.state === "wait");
      const done = list.filter((d) => d.endedAt);
      return [
        turn.length ? section("Твой ред", turn) : null,
        waiting.length ? section("Чакат приятелите ти", waiting) : null,
        friends().length
          ? h(
              "section",
              { class: "stack" },
              h("h2", { class: "section-title" }, "Предизвикай приятел"),
              h(
                "p",
                { class: "muted" },
                "Играеш веднага, а приятелят ти има 48 часа да изиграе своя. С един и същ приятел само първият дуел за деня мести рейтинга.",
              ),
              h(
                "ul",
                { class: "duel-friends" },
                friends().map((f) =>
                  h(
                    "li",
                    null,
                    h("span", null, h("strong", null, f.name), h("span", { class: "muted" }, ` @${f.tag}`)),
                    h("button", { class: "btn inline", type: "button", onclick: () => challenge(f) }, "Дуел"),
                  ),
                ),
              ),
            )
          : h(
              "p",
              { class: "muted" },
              h("a", { href: "/friends" }, "Добави приятели"),
              " и ги предизвиквай тук, когато им е удобно.",
            ),
        done.length ? section("История", done.slice(0, 20)) : null,
      ];
    },
  );
  screen.show(() => hub);
  return h("div", null, screen);
}

function section(heading: string, list: DuelView[]): Child {
  return h(
    "section",
    { class: "stack" },
    h("h2", { class: "section-title" }, heading),
    h("ul", { class: "duel-list" }, list.map(duelRow)),
  );
}

/** A challenge the player has said yes to elsewhere (the notice): its screen plays it at once, without asking again. */
let accepted = 0;

/** Plays a friend's challenge now: its screen, straight into the game. */
export function playChallenge(id: number): void {
  accepted = id;
  go(`/duel/${id}`);
}

/** A friend's playing of a duel the player started, as Начало hears of it. */
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

/** A friend has played the duel the player started: said once, above the day, a tap from the result. */
export function playedLine(p?: FriendPlayed | null): Child {
  if (!p || !told(p.id)) return null;
  return h(
    "p",
    { class: "streak-notice", role: "status" },
    `${p.from} изигра дуела ви: ${words[p.state]} ${formatNumber(p.you)} : ${formatNumber(p.them)}`,
    h("a", { href: `/duel/${p.id}` }, "Виж"),
  );
}

/** One duel: played now if it's the player's turn, else how it stands or ended. */
export function duelOne(params: string[]) {
  title("Дуел");
  const id = Number(params[0]);
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  (async () => {
    try {
      const d = await oneDuel(id);
      const play = async () => {
        loadDuelResult().catch(() => {}); // the result's screen, on its way while the player plays
        const s =
          d.runId && d.you
            ? await api<State>("GET", `/api/runs/${d.runId}`)
            : await api<State>("POST", `/api/duels/${id}/play`, {});
        checkWaiting(); // the notice goes
        screen.show(() => playRun(s, (end) => afterDuel(id, end.id), d.opponent?.name));
      };
      // Asked and not started: who asks, and the choice (unless said yes to already); started: straight back in.
      const yes = accepted === id;
      accepted = 0;
      if (d.state === "play" && !d.runId && !yes)
        return screen.show(() => asked(d, play, () => screen.show(() => duelResult({ ...d, state: "declined" }))));
      // Said yes from the notice, not started yet: the count-in first, with a way back (the challenge stays).
      if (d.state === "play" && !d.runId)
        return screen.show(() =>
          getReady(
            duelWith(d.opponent?.name),
            () => void play(),
            () => go("/duel"),
          ),
        );
      if (d.state === "play") return play();
      checkWaiting(); // a notice that pointed here, to a duel already played, goes
      told(d.id); // and Начало needn't say that the friend played it
      screen.show(() => duelResult(d));
    } catch (err) {
      screen.show(() => h("p", { role: "alert" }, (err as ApiError).message));
    }
  })();
  return h("div", null, screen);
}

/** A duel the player is asked to: who asks, and play it or say no. */
function asked(d: DuelView, play: () => Promise<void>, declined: () => void): Child {
  const error = signal("");
  const them = d.opponent?.name ?? "Някой";
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Дуел"),
      h("h1", null, `${them} те предизвика`),
      h("p", { class: "lead" }, `Десет въпроса, около три минути. Имаш време до ${until(d.expiresAt)}`),
    ),
    h(
      "button",
      {
        class: "btn primary big",
        type: "button",
        onclick: () => play().catch((err) => error.set((err as ApiError).message)),
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
            declined();
          } catch (err) {
            error.set((err as ApiError).message);
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
function afterDuel(id: number, run: number): Child {
  const view = signal<DuelView | null>(null);
  const error = signal("");
  oneDuel(id).then(view.set, (err) => error.set((err as ApiError).message));
  return h("div", null, () => {
    const d = view();
    if (d) return duelResult(d, null, news(run));
    return error() ? h("p", { class: "bad", role: "alert" }, error()) : h("p", { class: "muted" }, "…");
  });
}

/** „Дуел със Заек“, or just „Дуел“ without a name. */
const duelWith = (name?: string) => (name ? `Дуел ${withName(name)}` : "Дуел");

/** Challenges a friend (/duel/friend/<id>): the count-in first, with „Откажи“ — nothing is sent until it runs out or
 * „Започни сега“ — then the duel is made and the player's turn plays at once. A tap by mistake costs nothing. */
export function challengeFriend([idText]: string[]) {
  title("Дуел");
  const id = Number(idText);
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  const fail = (err: unknown) => screen.show(() => h("p", { role: "alert" }, (err as ApiError).message));
  (async () => {
    await player();
    const { friends } = await api<{ friends: Friend[] }>("GET", "/api/friends");
    const name = friends.find((f) => f.id === id)?.name;
    loadDuelResult().catch(() => {}); // the result's screen, on its way while the player plays
    screen.show(() =>
      getReady(
        duelWith(name),
        async () => {
          try {
            const r = await api<{ duel: number; state: State }>("POST", "/api/duels", { friend: id });
            history.replaceState(null, "", `/duel/${r.duel}`); // a reload comes back to this duel, not a new one
            screen.show(() => playRun(r.state, (end) => afterDuel(r.duel, end.id), name));
          } catch (err) {
            fail(err);
          }
        },
        () => (history.length > 1 ? history.back() : go("/duel")),
      ),
    );
  })().catch(fail);
  return h("div", null, screen);
}
