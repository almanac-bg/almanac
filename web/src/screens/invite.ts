// An invite link: a player's own, sent to a friend, and the link their shared day's result ends with. It brings
// whoever opens it to the day: how its owner did today („Мария има 8 от 10 днес. А ти?“, or „Мария те кани на
// днешните 10“ before she has played), the day's ten played right here, then the day's result as Начало has it (the
// streak, what it earned, tomorrow), with one card more: the two results side by side and the friendship, a tap away,
// never by itself (then a duel is a tap away).

import { shareButton } from "../game/results.ts";
import { playRun } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal, slot } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { player, user } from "../state.ts";
import { type Today, today } from "./today.ts";

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
  const info = signal<Info>({ by: "", own: false, friends: false });
  const fail = (err: unknown) => error.set((err as ApiError).message);
  let played = false; // the day's ten, just played here
  const big = (gold: boolean) => (gold ? "btn primary big" : "btn");
  const alert = () => error() && h("p", { class: "bad", role: "alert" }, error());

  const accept = async () => {
    error.set("");
    try {
      await player();
      const r = await api<{ id: number }>("POST", `/api/invites/${code}`, {});
      info.set({ ...info.peek(), friends: true, id: r.id });
      if (!played) screen.show(() => landing()); // its heading says so; after the day, only the card changes
    } catch (err) {
      fail(err);
    }
  };
  const challenge = () => go(`/challenge/${info.peek().id}`);
  const playDay = async () => {
    error.set("");
    try {
      await player();
      // The day as it stood before, for its result to grow from (the streak, the level), as on Начало.
      const before = await api<Today>("GET", "/api/day");
      const s = await api<State>("POST", "/api/day", {});
      screen.show(() =>
        playRun(s, (end) => {
          played = true;
          info.set({ ...info.peek(), mine: end.rights });
          return today([], { before, run: end, card: result });
        }),
      );
    } catch (err) {
      fail(err);
    }
  };

  /** Being friends: „Добави … в приятели“ until they are, then a challenge a tap away (`gold`: the screen's main
   * action). */
  const friendship =
    (gold: boolean): Child =>
    () => {
      const i = info();
      return i.friends
        ? [
            i.their === undefined ? null : h("p", { class: "muted", role: "status" }, "Вече сте приятели."),
            i.id ? h("button", { class: big(gold), onclick: challenge }, "Предизвикай") : null,
          ]
        : h("button", { class: big(gold), onclick: accept }, `Добави ${i.by} в приятели`);
    };

  /** The two results side by side, once both have played (a score never broken across lines). */
  const both = (mine: number) => {
    const i = info.peek();
    return i.their === undefined ? null : `Ти: ${mine} от 10 · ${i.by}: ${i.their} от 10`;
  };

  /** The day just played here, under its result: the two side by side, and the friendship. */
  const result = (): Child =>
    h(
      "section",
      { class: "card invite-card" },
      h("p", { class: "kicker" }, "Покана"),
      h("h2", { class: "card-title invite-both" }, both(info.peek().mine ?? 0) ?? `${info.peek().by} те покани`),
      friendship(false),
      alert,
    );

  const landing = (): Child => {
    const i = info.peek();
    const mine = i.mine;
    // Before its owner has played, the link is still to the day's ten: never „иска да сте приятели“ to a group chat.
    const heading =
      i.their !== undefined && mine === undefined
        ? `${i.by} има ${i.their} от 10 днес. А ти?`
        : (mine !== undefined && both(mine)) ||
          (i.friends
            ? `Вече сте приятели с ${i.by}`
            : mine === undefined
              ? `${i.by} те кани на днешните 10`
              : `${i.by} иска да сте приятели`);
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
      info.set(i);
      if (!i.own) return screen.show(landing);
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
          shareButton("Прати поканата", () => "Ела да сме приятели в АЛМАНАХ:", location.href, true, undefined, true),
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
