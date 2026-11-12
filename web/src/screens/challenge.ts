// A challenge: someone's ten questions, for anyone with the link, and how everyone did on them.

import { board, summary } from "../game/results.ts";
import { playRun } from "../game/run.ts";
import type { Score, State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { player, user } from "../state.ts";

interface Challenge {
  code: string;
  by: string;
  total: number;
  players: Score[];
  mine?: number;
}

export function challenge([code = ""]: string[]) {
  title("Предизвикателство");
  const screen = signal<Child>(h("p", { class: "muted" }, "…"));
  const load = async () => {
    try {
      const c = await api<Challenge>("GET", `/api/challenges/${code}`);
      const maker = c.players.find((p) => p.me && !c.mine);
      if (c.mine || maker) {
        const s = await api<State>("POST", `/api/challenges/${code}`, {});
        screen.set(s.done ? results(c, s) : playRun(s, (end) => results(c, end)));
      } else screen.set(intro(c));
    } catch (err) {
      screen.set(h("p", { role: "alert" }, (err as ApiError).message));
    }
  };

  const intro = (c: Challenge): Child => {
    const best = c.players[0];
    return h(
      "section",
      { class: "screen" },
      h(
        "div",
        { class: "intro" },
        h("p", { class: "kicker" }, "Предизвикателство"),
        h("h1", null, `${c.by} те предизвиква`),
      ),
      h(
        "p",
        { class: "lead" },
        best
          ? `${best.name} има ${best.rights} от ${c.total} на тези ${c.total} въпроса. Можеш ли повече?`
          : `${c.total} въпроса. Да видим колко знаеш.`,
      ),
      h(
        "button",
        {
          class: "btn primary big",
          onclick: async () => {
            try {
              await player();
              const s = await api<State>("POST", `/api/challenges/${code}`, {});
              screen.set(playRun(s, (end) => results(c, end)));
            } catch (err) {
              screen.set(h("p", { role: "alert" }, (err as ApiError).message));
            }
          },
        },
        "Приеми",
      ),
      user() ? null : h("p", { class: "muted" }, "Без регистрация: играеш веднага."),
    );
  };

  const results = (c: Challenge, s: State): Child => {
    const players = signal(c.players);
    api<Challenge>("GET", `/api/challenges/${code}`).then(
      (fresh) => players.set(fresh.players),
      () => {},
    );
    return h(
      "div",
      { class: "screen" },
      h("p", { class: "kicker" }, `Предизвикателството на ${c.by}`),
      summary(s, null, () => board("Кой колко има", players())),
    );
  };

  load();
  return h("div", null, () => screen());
}
