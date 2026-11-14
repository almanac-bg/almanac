// Дуел: two players, the same ten questions. Your division and rating; a live duel with whoever comes (screens/
// live.ts), or a friend challenged to play in their own time; the challenges that are your turn, those waiting on
// friends, and how the last duels went.

import { emblem } from "../art/emblem.ts";
import { nextSteps, reviewParts } from "../game/results.ts";
import { playRun } from "../game/run.ts";
import type { Reviewed, State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal, slot } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { checkWaiting, player, user } from "../state.ts";
import { back, type Division, formatNumber, meter, pageArt, profileHref, type Tier, who } from "../ui.ts";

interface Side {
  name: string;
  tag?: string;
  points: number;
  rights: number;
  ms: number;
  done: boolean;
  look?: { avatar?: string; title?: string; titleTier?: Tier; level?: number };
}

export interface DuelView {
  id: number;
  kind: "live" | "friend";
  state: "play" | "wait" | "won" | "lost" | "draw" | "declined" | "expired";
  opponent?: Side;
  you?: Side;
  recorded?: boolean;
  /** Didn't move ratings: the two had a rated duel that day already. */
  friendly?: boolean;
  delta?: number;
  runId?: number;
  createdAt: number;
  expiresAt: number;
  endedAt?: number;
}

export interface Standing {
  rating: number;
  rated: number;
  division: Division;
  next: number;
}

interface Friend {
  id: number;
  name: string;
  tag: string;
}

/** Your division: its emblem and name, your rating, and how far to the next. */
export function standingCard(s: Standing): Child {
  const span = s.next ? s.next - s.division.from : 0;
  const share = span ? Math.round((100 * (s.rating - s.division.from)) / span) : 100;
  return h(
    "section",
    { class: `card standing d-${s.division.id}` },
    emblem(s.division.id, "l"),
    h(
      "div",
      { class: "standing-text" },
      h("p", { class: "kicker" }, "Дивизия"),
      h("strong", { class: "standing-name" }, s.division.name),
      h("span", { class: "muted" }, `Рейтинг ${s.rating}${s.next ? ` · ${s.next - s.rating} до следващата` : ""}`),
      s.next ? meter(share, `${share}% до следващата дивизия`) : null,
    ),
  );
}

/** Seconds, the Bulgarian way: „34,5 с“. */
const secs = (ms: number) => `${(ms / 1000).toLocaleString("bg", { maximumFractionDigits: 1 })} с`;

export const until = (ms: number) =>
  new Intl.DateTimeFormat("bg", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));

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
  const challenge = async (friend: Friend) => {
    error.set("");
    try {
      const r = await api<{ duel: number; state: State }>("POST", "/api/duels", { friend: friend.id });
      screen.show(() => playRun(r.state, () => afterDuel(r.duel), friend.name));
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };
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
        { class: "muted" },
        "Ти и друг играч, на живо: едни и същи десет въпроса, в един и същи миг. Ако до 10 секунди не дойде никой, играеш срещу запис на истинска игра на играч с рейтинг като твоя.",
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
    () => {
      const d = data();
      return d ? standingCard(d.standing) : null;
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

/** One duel: played now if it's the player's turn, else how it stands or ended. */
export function duelOne(params: string[]) {
  title("Дуел");
  const id = Number(params[0]);
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  (async () => {
    try {
      const { duels } = await api<{ duels: DuelView[] }>("GET", "/api/duels");
      const d = duels.find((x) => x.id === id);
      if (!d) return screen.show(() => h("p", { role: "alert" }, "Този дуел вече го няма."));
      const play = async () => {
        const s =
          d.runId && d.you
            ? await api<State>("GET", `/api/runs/${d.runId}`)
            : await api<State>("POST", `/api/duels/${id}/play`, {});
        checkWaiting(); // the notice goes
        screen.show(() => playRun(s, () => afterDuel(id), d.opponent?.name));
      };
      // Asked and not started: who asks, and the choice (unless said yes to already); started: straight back in.
      const yes = accepted === id;
      accepted = 0;
      if (d.state === "play" && !d.runId && !yes)
        return screen.show(() => asked(d, play, () => screen.show(() => ended({ ...d, state: "declined" }))));
      if (d.state === "play") return play();
      screen.show(() => ended(d));
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
      h("p", { class: "lead" }, `Десет въпроса, около три минути. Имаш време до ${until(d.expiresAt)}.`),
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

/** Right after the player's run: the duel's result if the other has played too, else that it waits. */
function afterDuel(id: number): Child {
  const view = signal<DuelView | null>(null);
  api<{ duels: DuelView[] }>("GET", "/api/duels").then(
    (r) => view.set(r.duels.find((d) => d.id === id) ?? null),
    () => {},
  );
  return h("div", null, () => {
    const d = view();
    return d ? ended(d) : h("p", { class: "muted" }, "…");
  });
}

/** A duel as it stands or ended: who won, the two scores, the rating it moved; what to do next (`again`: another
 * duel, after a live one); what the game earned (`more`); and the questions to go over. */
export function ended(d: DuelView, again: Child = null, more: Child = null): Child {
  const questions =
    d.runId && d.you?.done
      ? reviewParts(async () => (await api<{ questions: Reviewed[] }>("GET", `/api/runs/${d.runId}/review`)).questions)
      : null;
  const heading =
    d.state === "wait"
      ? "Изигра своя дуел"
      : d.state === "won"
        ? "Победа!"
        : d.state === "lost"
          ? "Загуба"
          : d.state === "draw"
            ? "Равенство"
            : d.state === "declined"
              ? "Дуелът е отказан"
              : d.kind === "live"
                ? "Дуелът прекъсна"
                : "Времето за дуела изтече";
  const lead =
    d.state === "wait"
      ? `${d.opponent?.name ?? "Приятелят ти"} има време до ${until(d.expiresAt)}. Ще ти кажем резултата.`
      : d.state === "expired" && d.kind === "live"
        ? "Без резултат: рейтингът не се мени."
        : [
            d.recorded ? `Срещу запис на играта на ${d.opponent?.name ?? "друг играч"}: никой не дойде навреме.` : "",
            d.endedAt && d.you && d.opponent && d.you.points === d.opponent.points && d.state !== "draw"
              ? `Равни точки: реши времето (${secs(d.you.ms)} срещу ${secs(d.opponent.ms)}).`
              : "",
            d.friendly
              ? d.recorded
                ? "Срещу запис рейтингът се мени до пет пъти на ден: този дуел е приятелски."
                : "Приятелски дуел: днес вече сте играли, рейтингът не се мени."
              : "",
          ]
            .filter(Boolean)
            .join(" ") || null;
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, d.opponent ? `Дуел с ${d.opponent.name}` : "Дуел"),
      h("h1", null, heading),
      lead ? h("p", { class: "lead" }, lead) : null,
    ),
    d.endedAt && d.you && d.opponent && d.state !== "declined" && d.state !== "expired"
      ? h(
          "div",
          { class: "card duel-score" },
          side("Ти", d.you),
          h("span", { class: "duel-vs" }, ":"),
          side(d.opponent.name, d.opponent, d.opponent.tag),
          d.delta
            ? h(
                "p",
                { class: d.delta > 0 ? "duel-delta up" : "duel-delta down" },
                `Рейтинг ${d.delta > 0 ? "+" : ""}${d.delta}`,
              )
            : null,
        )
      : null,
    // The gold button is another duel where there's one (a live one), else the way back to the duels; the rest are
    // plain, side by side.
    nextSteps(again ?? toDuels(true), [questions?.button, again ? toDuels(false) : null]),
    more,
    questions?.list,
  );
}

const toDuels = (main: boolean) => h("a", { class: main ? "btn primary big" : "btn", href: "/duel" }, "Към дуелите");

function side(label: string, s: Side, tag?: string): Child {
  return h(
    "div",
    { class: "duel-side" },
    tag ? h("a", { class: "kicker", href: profileHref(tag) }, label) : h("span", { class: "kicker" }, label),
    h("b", { class: "duel-points" }, formatNumber(s.points)),
    h("span", { class: "muted" }, `${s.rights} от 10`),
  );
}
