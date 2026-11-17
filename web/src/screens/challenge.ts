// A challenge's link (/c/<code>, play/challenges.go): someone's game of ten, for whoever opens it to play the same
// questions as a duel against it, a guest as well as anyone. First who sent it and how they did, and „Започни“ (the
// count only after that tap); then the game; then the two side by side (screens/outcome.ts), with the way to add the
// one who sent it as a friend and to send the challenge on. One who has played it sees their result; the friend a
// friend's duel was sent to, their duel; the one who sent it, who has taken it. Past its time it says so, and offers
// the day's ten. A link from the old challenges (six letters) is gone the same way.

import { news } from "../game/news.ts";
import { challengeButton, challengeText } from "../game/results.ts";
import { getReady, playRun } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { duelResult, loadDuelResult } from "../kit.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal, slot } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { player, topics } from "../state.ts";
import { formatNumber, type Look, who } from "../ui.ts";
import type { DuelView } from "./duel.ts";

interface Challenge {
  code: string;
  by: { name: string; tag: string };
  look?: Look;
  rights: number;
  total: number;
  topic?: string;
  expiresAt: number;
  over?: boolean;
  own?: boolean;
  duel?: number;
  /** To the one who sent it: their game it was sent with. */
  run?: number;
  takers?: {
    name: string;
    tag: string;
    look?: Look;
    state: "won" | "lost" | "draw" | "play" | "wait";
    rights: number;
  }[];
}

const topicName = (id?: string) => (id ? topics.find((t) => t.id === id)?.name : undefined);

export function challenge([code = ""]: string[]) {
  title("Предизвикателство");
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  api<Challenge>("GET", `/api/challenges/${code}`).then(
    (c) => {
      // The viewer's own game of it (a taker's, or the friend's duel it was sent for): there, not here again.
      if (c.duel) return go(`/duel/${c.duel}`, true);
      if (c.own) return screen.show(() => own(c));
      if (c.over) return screen.show(() => gone("Времето за това предизвикателство изтече"));
      screen.show(() => asked(c, screen));
    },
    (err) =>
      screen.show(() =>
        (err as ApiError).code === "no_challenge" || (err as ApiError).code === "not_found"
          ? gone("Това предизвикателство вече го няма")
          : h("p", { class: "bad", role: "alert" }, (err as ApiError).message),
      ),
  );
  return h("div", null, screen);
}

/** A challenge past its time, or gone: the day's ten instead. */
function gone(heading: string): Child {
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Предизвикателство"),
      h("h1", null, heading),
      h("p", { class: "lead" }, "Десетте въпроса за днес са едни и същи за всички: изиграй ги и сравни."),
    ),
    h("a", { class: "btn primary big", href: "/" }, "Въпросите на деня"),
  );
}

/** Who challenges, and how they did: the same ten, a tap away. */
function asked(c: Challenge, screen: ReturnType<typeof slot>): Child {
  const error = signal("");
  const topic = topicName(c.topic);
  const start = () =>
    screen.show(() =>
      getReady(
        "Предизвикателство",
        async () => {
          screen.show(() => h("p", { class: "muted" }, "…"));
          try {
            await player();
            loadDuelResult().catch(() => {}); // the result's screen, on its way while the player plays
            const r = await api<{ duel: number; state?: State }>("POST", `/api/challenges/${c.code}/play`, {});
            if (!r.state) return go(`/duel/${r.duel}`, true);
            history.replaceState(null, "", `/duel/${r.duel}`); // a reload comes back to this duel
            screen.show(() => playRun(r.state as State, (end) => after(r.duel, end.id), c.by.name));
          } catch (err) {
            error.set((err as ApiError).message);
            screen.show(() => asked(c, screen));
          }
        },
        () => screen.show(() => asked(c, screen)),
      ),
    );
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Предизвикателство"),
      h("h1", null, `${c.by.name} те предизвиква`),
      h(
        "p",
        { class: "lead" },
        `${c.by.name} позна ${c.rights} от ${c.total}${topic ? ` по „${topic}“` : ""}. Изиграй същите десет въпроса и вижте кой знае повече. Около три минути.`,
      ),
    ),
    h("button", { class: "btn primary big", type: "button", onclick: start }, "Започни"),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

/** Right after the taker's game: the two side by side, and what the game earned. */
function after(id: number, run: number): Child {
  const view = signal<DuelView | null>(null);
  const error = signal("");
  api<{ duel: DuelView }>("GET", `/api/duels/${id}`).then(
    (r) => view.set(r.duel),
    (err) => error.set((err as ApiError).message),
  );
  return h("div", null, () => {
    const d = view();
    if (d) return duelResult(d, null, news(run));
    return error() ? h("p", { class: "bad", role: "alert" }, error()) : h("p", { class: "muted" }, "…");
  });
}

const stateWords = { won: "Ти печелиш", lost: "Печели", draw: "Равенство", play: "Играе", wait: "Изигра" };

/** The one who sent it: who has taken it so far, and the link to send again. */
function own(c: Challenge): Child {
  const topic = topicName(c.topic);
  const takers = c.takers ?? [];
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Твоето предизвикателство"),
      h("h1", null, `${c.rights} от ${c.total}${topic ? ` по „${topic}“` : ""}`),
      h(
        "p",
        { class: "lead" },
        takers.length
          ? takers.length === 1
            ? "Изигра го един човек."
            : `Изиграха го ${formatNumber(takers.length)} души.`
          : "Още никой не го е изиграл.",
      ),
    ),
    // Sent again, its time to be taken starts again.
    c.run ? challengeButton("Прати го пак", c.run, () => challengeText(c.rights, topic), true) : null,
    c.over ? h("p", { class: "muted" }, "Времето му беше изтекло: прати го пак и тече отново.") : null,
    takers.length
      ? h(
          "ul",
          { class: "duel-list" },
          takers.map((t) =>
            h(
              "li",
              { class: "duel-row" },
              who(t.name, t.look ?? {}, null, t.name, t.tag),
              h(
                "span",
                { class: "duel-row-end" },
                h("strong", { class: "duel-state" }, stateWords[t.state]),
                t.state === "play" || t.state === "wait"
                  ? null
                  : h("span", { class: "muted" }, `${t.rights} от ${c.total}`),
              ),
            ),
          ),
        )
      : null,
  );
}
