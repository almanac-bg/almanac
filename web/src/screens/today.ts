// Днес: the day's ten questions, the same for everyone, once.

import { board, shareButton, squares, summary } from "../game/results.ts";
import { playRun } from "../game/run.ts";
import type { Board, State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { player } from "../state.ts";

interface Today {
  day: string;
  streak: number;
  run: State | null;
  board: Board;
}

const longDate = (day: string) =>
  new Intl.DateTimeFormat("bg", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );
const shortDate = (day: string) =>
  new Intl.DateTimeFormat("bg", { day: "numeric", month: "long", timeZone: "UTC" }).format(
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
    return h(
      "section",
      { class: "screen" },
      h("p", { class: "muted" }, longDate(t.day)),
      h("h1", null, "Десет въпроса за днес"),
      h("p", null, "По един от всяка тема, от лесен към труден. Едни и същи за всички, с един опит."),
      h(
        "button",
        {
          class: "btn",
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
      h("p", { class: "muted" }, about(t)),
    );
  };

  load();
  return h("div", null, () => screen());
}

/** One line of what there is to know: the streak, who played, the time. */
function about(t: Today): string {
  const parts: string[] = [];
  if (t.streak > 0) parts.push(t.streak === 1 ? "Серия: 1 ден" : `Серия: ${t.streak} дни`);
  if (t.board.players > 0) parts.push(t.board.players === 1 ? "1 човек днес" : `${t.board.players} души днес`);
  parts.push("15 секунди за въпрос");
  return parts.join(" · ");
}

function finished(t: Today, s: State): Child {
  const fresh = signal<Board>(t.board);
  // The board as it is now, with this result on it.
  api<Board>("GET", `/api/day/${t.day}/board`).then(fresh.set, () => {});
  return h(
    "div",
    { class: "screen" },
    h("p", { class: "muted" }, longDate(t.day)),
    summary(
      s,
      () => {
        const b = fresh();
        return b.place ? h("p", null, `${b.place}-и от ${b.players} днес.`) : null;
      },
      shareButton(
        "Сподели резултата",
        () => `АЛМАНАХ · ${shortDate(t.day)}\n${s.rights}/10 · ${s.points} т.\n${squares(s.trail)}`,
        location.origin,
      ),
      countdown(),
      () => {
        const b = fresh();
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
