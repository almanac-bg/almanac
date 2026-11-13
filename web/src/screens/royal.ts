// Роял: a tournament in each one's own time — up to twenty players on the same fifteen questions, easy to hard in
// three rounds, and the first wrong answer is the way out. The tournament you're in, who's in it and how far each
// got; and how the last ones ended.

import { playRun } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { player, user } from "../state.ts";
import { type Tier, who } from "../ui.ts";
import { type Standing, standingCard } from "./duel.ts";

interface RoyalPlayer {
  name: string;
  tag: string;
  reached: number;
  out: boolean;
  done: boolean;
  place?: number;
  delta?: number;
  me?: boolean;
  avatar?: string;
  title?: string;
  titleTier?: Tier;
  level?: number;
}

interface Royal {
  id: number;
  length: number;
  round: number;
  size: number;
  closesAt: number;
  endedAt?: number;
  players: RoyalPlayer[];
  runId?: number;
}

const at = (ms: number) =>
  new Intl.DateTimeFormat("bg", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));

/** How far a player got, in words: through all of it, out in a round, or still playing. */
function reach(p: RoyalPlayer, t: Royal): string {
  if (!p.done) return p.reached ? `играе · ${p.reached} верни` : "още не е играл";
  if (!p.out) return `всичките ${t.length}!`;
  const round = Math.min(3, Math.floor(p.reached / t.round) + 1);
  return `отпадна в кръг ${round}, на въпрос ${p.reached + 1}`;
}

/** A tournament: who's in it, by place or by how far they got. */
function table(t: Royal): Child {
  return h(
    "section",
    { class: "board royal-table" },
    h(
      "h2",
      null,
      t.endedAt ? "Класиране" : `Турнир · ${t.players.length} от ${t.size}`,
      t.endedAt ? null : h("span", { class: "muted" }, ` · до ${at(t.closesAt)}`),
    ),
    h(
      "ol",
      null,
      t.players.map((p, i) =>
        h(
          "li",
          { class: ["row", p.me && "me", p.out && "out"].filter(Boolean).join(" ") },
          h("span", { class: "place" }, String(p.place ?? i + 1)),
          who(p.name, p, p.me ? h("span", { class: "you" }, "ти") : null, p.name),
          h(
            "span",
            { class: "royal-reach" },
            h("span", { class: "muted" }, reach(p, t)),
            p.delta
              ? h("span", { class: p.delta > 0 ? "delta up" : "delta down" }, `${p.delta > 0 ? "+" : ""}${p.delta}`)
              : null,
          ),
        ),
      ),
    ),
  );
}

export function royal() {
  title("Роял");
  const data = signal<{ royals: Royal[]; standing: Standing } | null>(null);
  const screen = signal<Child>(null);
  const error = signal("");
  const load = () =>
    user.peek()
      ? api<{ royals: Royal[]; standing: Standing }>("GET", "/api/royal").then(data.set, () => {})
      : undefined;
  load();
  const join = async () => {
    error.set("");
    try {
      await player();
      const r = await api<{ royal: number; state: State }>("POST", "/api/royal", {});
      screen.set(playRun(r.state, () => after(r.royal)));
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };
  const after = (id: number): Child => {
    const view = signal<Royal | null>(null);
    api<{ royals: Royal[] }>("GET", "/api/royal").then(
      (r) => view.set(r.royals.find((t) => t.id === id) ?? null),
      () => {},
    );
    return h("div", null, () => {
      const t = view();
      if (!t) return h("p", { class: "muted" }, "…");
      const me = t.players.find((p) => p.me);
      return h(
        "section",
        { class: "screen" },
        h(
          "div",
          { class: "intro" },
          h("p", { class: "kicker" }, "Роял"),
          h("h1", null, me && !me.out ? "Стигна до края!" : `Отпадна на въпрос ${(me?.reached ?? 0) + 1}`),
          h(
            "p",
            { class: "lead" },
            t.endedAt
              ? `Турнирът свърши: ${me?.place ?? "—"}-и от ${t.players.length}.`
              : `Класирането идва, щом всички изиграят или в ${at(t.closesAt)}.`,
          ),
        ),
        table(t),
        h("a", { class: "btn primary big", href: "/royal" }, "Към Роял"),
      );
    });
  };
  screen.set(
    h(
      "section",
      { class: "screen" },
      h(
        "div",
        { class: "intro" },
        h("h1", null, "Роял"),
        h(
          "p",
          { class: "lead" },
          "До двадесет играчи, едни и същи петнадесет въпроса — от лесни към трудни, в три кръга. Първият грешен отговор те изважда. Всеки играе, когато може.",
        ),
      ),
      () => {
        const d = data();
        return d ? standingCard(d.standing) : null;
      },
      () => {
        const open = data()?.royals.find((t) => !t.endedAt);
        const mine = open?.players.find((p) => p.me);
        return h(
          "button",
          { class: "btn primary big", type: "button", onclick: join },
          open && mine && !mine.done ? "Продължи турнира" : "Влез в турнир",
        );
      },
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
      () => {
        const list = data()?.royals ?? [];
        const open = list.filter((t) => !t.endedAt);
        const ended = list.filter((t) => t.endedAt);
        return [
          ...open.map(table),
          ended.length
            ? h(
                "section",
                { class: "stack" },
                h("h2", { class: "section-title" }, "Изиграни"),
                h(
                  "ul",
                  { class: "duel-list" },
                  ended.map((t) => {
                    const me = t.players.find((p) => p.me);
                    return h(
                      "li",
                      { class: "duel-row" },
                      h("strong", null, me?.place ? `${me.place}-и от ${t.players.length}` : "Без класиране"),
                      h(
                        "span",
                        { class: "duel-row-end" },
                        h("span", { class: "muted" }, me ? reach(me, t) : ""),
                        me?.delta
                          ? h(
                              "span",
                              { class: me.delta > 0 ? "delta up" : "delta down" },
                              `${me.delta > 0 ? "+" : ""}${me.delta}`,
                            )
                          : null,
                      ),
                    );
                  }),
                ),
              )
            : null,
        ];
      },
    ),
  );
  return h("div", null, () => screen());
}
