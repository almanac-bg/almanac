// Дуел: two players, the same ten questions, each played when they can. Your division and rating; a duel with
// whoever comes, or a friend; the duels that are your turn, those waiting, and how the last ones went.

import { emblem } from "../art/emblem.ts";
import { review } from "../game/results.ts";
import { playRun } from "../game/run.ts";
import type { Reviewed, State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { player, user } from "../state.ts";
import { meter, type Tier, who } from "../ui.ts";

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
  kind: "open" | "friend";
  state: "play" | "wait" | "won" | "lost" | "draw" | "declined" | "expired";
  opponent?: Side;
  you?: Side;
  recorded?: boolean;
  delta?: number;
  runId?: number;
  createdAt: number;
  expiresAt: number;
  endedAt?: number;
}

export interface Standing {
  rating: number;
  rated: number;
  division: { id: "bronze" | "silver" | "gold" | "platinum" | "diamond" | "legend"; name: string; from: number };
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

const until = (ms: number) =>
  new Intl.DateTimeFormat("bg", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));

const words: Record<DuelView["state"], string> = {
  play: "Твой ред",
  wait: "Чака",
  won: "Победа",
  lost: "Загуба",
  draw: "Равенство",
  declined: "Отказан",
  expired: "Изтекъл",
};

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
          : `${d.you?.points ?? 0} : ${them?.points ?? 0}${d.recorded ? " · срещу запис" : ""}`;
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
  const screen = signal<Child>(null);
  const error = signal("");
  if (user.peek()) {
    api<{ duels: DuelView[]; standing: Standing }>("GET", "/api/duels").then(data.set, () => {});
    api<{ friends: Friend[] }>("GET", "/api/friends").then(
      (f) => friends.set(f.friends),
      () => {},
    );
  }
  const start = async (friend?: number) => {
    error.set("");
    try {
      await player();
      const r = await api<{ duel: number; state: State }>("POST", "/api/duels", friend ? { friend } : {});
      screen.set(playRun(r.state, () => afterDuel(r.duel)));
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
      h("h1", null, "Дуел"),
      h(
        "p",
        { class: "lead" },
        "Ти и още някой, на едни и същи десет въпроса — всеки когато има време. Победите вдигат рейтинга ти.",
      ),
    ),
    () => {
      const d = data();
      return d ? standingCard(d.standing) : null;
    },
    h("button", { class: "btn primary big", type: "button", onclick: () => start() }, "Намери съперник"),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
    () => {
      const list = data()?.duels ?? [];
      const turn = list.filter((d) => d.state === "play");
      const waiting = list.filter((d) => d.state === "wait");
      const done = list.filter((d) => d.endedAt);
      return [
        turn.length ? section("Твой ред", turn) : null,
        waiting.length ? section("Чакат", waiting) : null,
        friends().length
          ? h(
              "section",
              { class: "stack" },
              h("h2", { class: "section-title" }, "Предизвикай приятел"),
              h(
                "ul",
                { class: "duel-friends" },
                friends().map((f) =>
                  h(
                    "li",
                    null,
                    h("span", null, h("strong", null, f.name), h("span", { class: "muted" }, ` @${f.tag}`)),
                    h("button", { class: "btn inline", type: "button", onclick: () => start(f.id) }, "Дуел"),
                  ),
                ),
              ),
            )
          : h("p", { class: "muted" }, "Добави приятели в Профил → Приятели и ги предизвиквай тук."),
        done.length ? section("История", done.slice(0, 20)) : null,
      ];
    },
  );
  screen.set(hub);
  return h("div", null, () => screen());
}

function section(heading: string, list: DuelView[]): Child {
  return h(
    "section",
    { class: "stack" },
    h("h2", { class: "section-title" }, heading),
    h("ul", { class: "duel-list" }, list.map(duelRow)),
  );
}

/** One duel: played now if it's the player's turn, else how it stands or ended. */
export function duelOne(params: string[]) {
  title("Дуел");
  const id = Number(params[0]);
  const screen = signal<Child>(h("p", { class: "muted" }, "…"));
  (async () => {
    try {
      const { duels } = await api<{ duels: DuelView[] }>("GET", "/api/duels");
      const d = duels.find((x) => x.id === id);
      if (!d) return screen.set(h("p", { role: "alert" }, "Този дуел вече го няма."));
      const play = async () => {
        const s =
          d.runId && d.you
            ? await api<State>("GET", `/api/runs/${d.runId}`)
            : await api<State>("POST", `/api/duels/${id}/play`, {});
        screen.set(playRun(s, () => afterDuel(id)));
      };
      // Asked and not started: who asks, and the choice; started: straight back in.
      if (d.state === "play" && !d.runId)
        return screen.set(asked(d, play, () => screen.set(ended({ ...d, state: "declined" }))));
      if (d.state === "play") return play();
      screen.set(ended(d));
    } catch (err) {
      screen.set(h("p", { role: "alert" }, (err as ApiError).message));
    }
  })();
  return h("div", null, () => screen());
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

/** A duel as it stands or ended: who won, the two scores, the rating it moved; and the questions to go over. */
function ended(d: DuelView): Child {
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
              : "Дуелът изтече";
  const lead =
    d.state === "wait"
      ? d.opponent
        ? `${d.opponent.name} има време до ${until(d.expiresAt)}. Ще ти кажем резултата.`
        : `Щом някой изиграе същите въпроси, ще разбереш кой е по-добър. Ако до ${until(d.expiresAt)} няма никой, ще се мериш с запис на истинска игра.`
      : d.recorded
        ? `Срещу запис на играта на ${d.opponent?.name ?? "друг играч"}: никой не дойде навреме.`
        : null;
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
          side(d.opponent.name, d.opponent),
          d.delta
            ? h(
                "p",
                { class: d.delta > 0 ? "duel-delta up" : "duel-delta down" },
                `Рейтинг ${d.delta > 0 ? "+" : ""}${d.delta}`,
              )
            : null,
        )
      : null,
    h("a", { class: "btn primary big", href: "/duel" }, "Към дуелите"),
    d.runId && d.you?.done
      ? review(async () => (await api<{ questions: Reviewed[] }>("GET", `/api/runs/${d.runId}/review`)).questions)
      : null,
  );
}

function side(label: string, s: Side): Child {
  return h(
    "div",
    { class: "duel-side" },
    h("span", { class: "kicker" }, label),
    h("b", { class: "duel-points" }, String(s.points)),
    h("span", { class: "muted" }, `${s.rights} от 10`),
  );
}
