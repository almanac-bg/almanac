// An invite link: a player's own, sent to a friend, and the link their shared day's result ends with. It brings
// whoever opens it to the day: how its owner did today („Мария има 8 от 10 днес. А ти?“), the day's ten played right
// here, then the two results side by side; and the friendship, a tap away, never by itself (then a duel is a tap away).

import { shareButton, summary } from "../game/results.ts";
import { playRun } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal, slot } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { player, user } from "../state.ts";

interface Info {
  by: string;
  own: boolean;
  friends: boolean;
  /** The owner's id, once friends (for a duel). */
  id?: number;
  /** How many right the owner has today, and the one who opened it, once each has played the day's ten. */
  their?: number;
  mine?: number;
}

export function invite([code = ""]: string[]) {
  title("Покана");
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  const error = signal("");
  let info: Info;
  let played: State | null = null; // the day's ten, just played here
  const fail = (err: unknown) => error.set((err as ApiError).message);
  const show = () => screen.show(() => (played ? result(played) : landing()));
  const big = (gold: boolean) => (gold ? "btn primary big" : "btn");
  const alert = () => error() && h("p", { class: "bad", role: "alert" }, error());

  const accept = async () => {
    error.set("");
    try {
      await player();
      const r = await api<{ id: number }>("POST", `/api/invites/${code}`, {});
      info = { ...info, friends: true, id: r.id };
      show();
    } catch (err) {
      fail(err);
    }
  };
  const duel = async () => {
    try {
      go(`/duel/${(await api<{ duel: number }>("POST", "/api/duels", { friend: info.id })).duel}`);
    } catch (err) {
      fail(err);
    }
  };
  const playDay = async () => {
    error.set("");
    try {
      await player();
      const s = await api<State>("POST", "/api/day", {});
      screen.show(() =>
        playRun(s, (end) => {
          played = end;
          info = { ...info, mine: end.rights };
          return result(end);
        }),
      );
    } catch (err) {
      fail(err);
    }
  };

  /** Being friends: „Добави … в приятели“ until they are, then a duel a tap away (`gold`: the screen's main action). */
  const friendship = (gold: boolean): Child =>
    info.friends
      ? [
          info.their === undefined ? null : h("p", { class: "muted", role: "status" }, "Вече сте приятели."),
          info.id ? h("button", { class: big(gold), onclick: duel }, "Покани на дуел") : null,
        ]
      : h("button", { class: big(gold), onclick: accept }, `Добави ${info.by} в приятели`);

  /** The two results side by side, once both have played (a score never broken across lines). */
  const both = (mine: number) =>
    info.their === undefined ? null : `Ти: ${mine} от 10 · ${info.by}: ${info.their} от 10`;

  /** The day just played here: its result, the two side by side, and the friendship as the gold action. */
  const result = (run: State): Child =>
    h(
      "section",
      { class: "screen" },
      summary(run, h("p", { class: "place-line" }, both(run.rights)), {
        main: friendship(true),
        also: [h("a", { class: "btn", href: "/" }, "Към Начало")],
      }),
      alert,
    );

  const landing = (): Child => {
    const mine = info.mine;
    const heading =
      info.their !== undefined && mine === undefined
        ? `${info.by} има ${info.their} от 10 днес. А ти?`
        : (mine !== undefined && both(mine)) ||
          (info.friends ? `Вече сте приятели с ${info.by}` : `${info.by} иска да сте приятели`);
    return h(
      "section",
      { class: "screen" },
      h(
        "div",
        { class: "intro" },
        h("p", { class: "kicker" }, "Покана"),
        h("h1", null, heading),
        h(
          "p",
          { class: "lead" },
          mine === undefined
            ? `Десет въпроса за днес, едни и същи за всички.${user() ? "" : " Без регистрация: играеш веднага."}`
            : "Приятелите виждат резултатите си за деня и се предизвикват на дуел.",
        ),
      ),
      // The day's ten first, while they wait; then being friends.
      mine === undefined ? h("button", { class: "btn primary big", onclick: playDay }, "Играй днешните 10") : null,
      friendship(mine !== undefined),
      alert,
    );
  };

  api<Info>("GET", `/api/invites/${code}`).then(
    (i) => {
      info = i;
      if (!i.own) return show();
      screen.show(() =>
        h(
          "section",
          { class: "screen" },
          h(
            "div",
            { class: "intro" },
            h("p", { class: "kicker" }, "Покана"),
            h("h1", null, "Това е твоята покана"),
            h("p", { class: "lead" }, "Прати я на приятел: щом я отвори и приеме, ставате приятели."),
          ),
          shareButton("Прати поканата", () => "Ела да сме приятели в АЛМАНАХ:", location.href),
        ),
      );
    },
    (err: ApiError) =>
      screen.show(() =>
        h(
          "section",
          { class: "screen" },
          h("h1", null, "Тази покана я няма"),
          h("p", { class: "lead" }, err.message),
          h("a", { class: "btn primary", href: "/friends" }, "Към приятелите"),
        ),
      ),
  );
  return h("div", null, screen);
}
