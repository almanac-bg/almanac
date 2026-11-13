// Начало: the day's ten questions, the same for everyone, once; your streak; the day's goals; and every other way
// to play — with others, and by topic.

import { news } from "../game/news.ts";
import { board, summary } from "../game/results.ts";
import { playRun, trail } from "../game/run.ts";
import type { Board, Score, State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { player, user } from "../state.ts";
import { figure, streak } from "../ui.ts";
import { modes } from "./modes.ts";
import { topics } from "./play.ts";
import { goalsCard } from "./season.ts";

interface Today {
  day: string;
  streak: number;
  /** This week's days played, Monday first (for a player who has played). */
  week?: boolean[];
  run: State | null;
  board: Board;
  /** The day among the player and their friends, once a friend has finished it too. */
  friends?: Score[] | null;
}

const longDate = (day: string) =>
  new Intl.DateTimeFormat("bg", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );

export function today() {
  title();
  const screen = signal<Child>(h("p", { class: "muted" }, "…"));
  const load = async () => {
    try {
      const t = await api<Today>("GET", "/api/day");
      if (t.run && !t.run.done) screen.set(playRun(t.run, (s) => finished(t, s)));
      else if (t.run) screen.set(finished(t, t.run));
      else screen.set(intro(t));
    } catch (err) {
      screen.set(h("p", { role: "alert" }, (err as ApiError).message));
    }
  };

  const intro = (t: Today): Child => {
    const busy = signal(false);
    const error = signal("");
    const players = t.board.players;
    return h(
      "section",
      { class: "screen" },
      h(
        "div",
        { class: "intro" },
        h("p", { class: "kicker" }, longDate(t.day)),
        h("h1", null, "Десет въпроса за днес"),
        h("p", { class: "lead" }, "По един от всяка тема, от лесен към труден. Едни и същи за всички, с един опит."),
      ),
      h(
        "div",
        { class: "card hero" },
        h(
          "div",
          { class: "figures" },
          figure("10", "въпроса"),
          figure("~3", "минути"),
          figure(String(players), players === 1 ? "човек днес" : "души днес"),
        ),
        trail([], 10),
      ),
      h(
        "button",
        {
          class: "btn primary big",
          disabled: busy,
          onclick: async () => {
            busy.set(true);
            try {
              await player();
              const s = await api<State>("POST", "/api/day", {});
              screen.set(playRun(s, (end) => finished(t, end)));
            } catch (err) {
              error.set((err as ApiError).message);
              busy.set(false);
            }
          },
        },
        "Започни",
      ),
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
      user.peek() ? streak(t.streak, t.week) : null,
      goalsCard(),
      modes(["duel", "royal", "room"], "С други"),
      topics(),
    );
  };

  load();
  return h("div", null, () => screen());
}

function finished(t: Today, s: State): Child {
  // The day as it is now, with this result on it: the board, the place, the streak it made.
  const fresh = signal<Today>(t);
  api<Today>("GET", "/api/day").then(fresh.set, () => {});
  return h(
    "div",
    { class: "screen" },
    h("p", { class: "kicker" }, longDate(t.day)),
    summary(
      s,
      () => {
        const b = fresh().board;
        return b.place ? h("p", { class: "place-line" }, `${b.place}-и от ${b.players} днес.`) : null;
      },
      news(s.id),
      () => {
        const f = fresh();
        return f !== t || t.run?.done ? streak(f.streak, f.week) : null;
      },
      countdown(),
      goalsCard(),
      modes(["duel", "royal", "room"], "С други"),
      topics(),
      () => {
        const f = fresh().friends;
        return f?.length ? board("Приятели днес", f) : null;
      },
      () => {
        const b = fresh().board;
        return board("Днес", b.top, b.place, b.mine);
      },
    ),
  );
}

/** Time until the next day's questions (midnight in Bulgaria). */
function countdown(): Child {
  const left = signal(untilMidnight());
  const t = setInterval(() => left.set(untilMidnight()), 30_000);
  onCleanup(() => clearInterval(t));
  return h("p", { class: "muted" }, () => `Нови въпроси след ${left()}.`);
}

function untilMidnight(): string {
  const now = new Date();
  const sofia = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Sofia" }));
  const minutes = 24 * 60 - (sofia.getHours() * 60 + sofia.getMinutes());
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} ч и ${minutes % 60} мин` : `${minutes} мин`;
}
