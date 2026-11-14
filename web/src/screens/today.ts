// Начало: where every game starts, on one short screen, and the day is its heart. At the top the player's streak and
// level; then the day's ten questions, the same for everyone, once (or, once played, how they went, and the result to
// share); the day's goals; and every other way to play a tap away: by topic, and — once a first game is finished —
// with others. The day's boards are in Класации.

import { picture } from "../art/picture.ts";
import { news } from "../game/news.ts";
import { shareButton, summary } from "../game/results.ts";
import { playRun, trail } from "../game/run.ts";
import { dayShareText } from "../game/share.ts";
import type { Board, State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal, slot } from "../lib/dom.ts";
import { askToKeep } from "../lib/keep.ts";
import { place } from "../lib/ordinal.ts";
import { title } from "../lib/router.ts";
import { dayInBulgaria } from "../lib/year.ts";
import { player, playing, user } from "../state.ts";
import { meter, reserveWords } from "../ui.ts";
import { goalsCard } from "./goals.ts";
import { modes } from "./modes.ts";
import { topics } from "./play.ts";
import { signIn } from "./settings.ts";
import { yearCard } from "./year.ts";

interface Today {
  day: string;
  streak: number;
  /** This week's days played, Monday first (for a player who has played). */
  week?: boolean[];
  /** Reserve days in hand: each keeps the streak through a day missed. */
  reserve?: number;
  /** The player's level, from all their XP (for a player). */
  level?: { level: number; xp: number; from: number; to: number };
  /** Whether the player has finished a game of any kind: until then Начало is the day and the topics only. */
  played?: boolean;
  run: State | null;
  board: Board;
}

const longDate = (day: string) =>
  new Intl.DateTimeFormat("bg", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );

export function today() {
  title();
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  const load = async () => {
    try {
      const t = await api<Today>("GET", "/api/day");
      day = t.day;
      const run = t.run;
      if (run && !run.done) screen.show(() => playRun(run, (s) => home(t, s, true)));
      else screen.show(() => home(t, t.run, false));
    } catch (err) {
      screen.show(() => h("p", { role: "alert" }, (err as ApiError).message));
    }
  };
  const start = (t: Today) => async () => {
    await player();
    const s = await api<State>("POST", "/api/day", {});
    screen.show(() => playRun(s, (end) => home(t, end, true)));
  };
  // A new day while the screen stays open (a phone left on Начало overnight): the new day's ten, not yesterday's
  // result with a countdown to a day that has come. Never in the middle of a game.
  let day = "";
  const newDay = () => {
    if (day && !document.hidden && !playing.peek() && dayInBulgaria() !== day) load();
  };
  document.addEventListener("visibilitychange", newDay);
  const every = setInterval(newDay, 60_000);
  onCleanup(() => {
    document.removeEventListener("visibilitychange", newDay);
    clearInterval(every);
  });
  load();
  return h("div", null, screen);

  /** The screen itself: the day as it stands (`run` its result, if played; `just`: played this moment, so what it
   * earned is told once), then the ways to play. */
  function home(t: Today, run: State | null, just: boolean): Child {
    // Just played: the streak, the level and the place it made, as they are now.
    const fresh = signal<Today>(t);
    if (just) api<Today>("GET", "/api/day").then(fresh.set, () => {});
    return h(
      "section",
      { class: "screen home" },
      // A new player, before a first game finished, sees the day and the topics only.
      () => (user() && (just || t.played) ? status(fresh()) : null),
      run?.done
        ? summary(
            run,
            h("div", { class: "day-line" }, h("span", { class: "kicker" }, longDate(t.day)), () => {
              const b = fresh().board;
              return b.place
                ? h("a", { class: "place-line", href: "/ranks" }, `${place(b.place, b.players)} днес`)
                : null;
            }),
            // The result is the one to share: „Сподели“ is the gold button, right under it; then what it earned.
            { main: shareButton("Сподели", () => dayShareText(t.day, run.trail, run.total, fresh().streak)) },
            [just ? news(run.id) : null, countdown()],
          )
        : dayCard(t, start(t)),
      // Mid-December into January: the year in the game, a tap away.
      yearCard(),
      // A guest who keeps coming back is asked to keep their profile, once the day is played (the day comes first),
      // and not right after a game, which has its news.
      just || !run?.done ? null : keepCard(t),
      // Just played, the goals it finished are told with its news.
      just || !t.played ? null : goalsCard(),
      // The ways to play with others wait for a first game finished: a new player starts with the day and a topic.
      just || t.played ? modes(["duel", "royal", "room"], "С други") : null,
      topics(),
    );
  }
}

/** The streak and the level, side by side: each a tap from Профил, where there's more of both. */
function status(t: Today): Child {
  const days = t.streak;
  const lv = t.level;
  const share = lv && lv.to > lv.from ? Math.round((100 * (lv.xp - lv.from)) / (lv.to - lv.from)) : 0;
  return h(
    "div",
    { class: "status-row" },
    h(
      "a",
      { class: days ? "status-item streak-chip" : "status-item streak-chip cold", href: "/me" },
      picture("flame", "flame status-flame"),
      h(
        "span",
        { class: "status-text" },
        h("b", { class: "status-n" }, String(days)),
        h("span", { class: "status-label" }, days === 1 ? "ден поред" : "дни поред"),
      ),
      t.reserve
        ? h(
            "span",
            { class: "status-reserve", title: reserveWords(t.reserve) },
            picture("shield", "reserve-pic"),
            h("b", { class: "num", "aria-hidden": "true" }, String(t.reserve)),
            h("span", { class: "sr" }, reserveWords(t.reserve)),
          )
        : null,
    ),
    lv
      ? h(
          "a",
          { class: "status-item level-chip", href: "/me" },
          h(
            "span",
            { class: "status-text" },
            h("b", { class: "status-n" }, `Ниво ${lv.level}`),
            h("span", { class: "status-label" }, `още ${lv.to - lv.xp} XP`),
          ),
          meter(share, `${share}% от ниво ${lv.level}`),
        )
      : null,
  );
}

/** The day's ten, not played yet: what they are, and the gold button. */
function dayCard(t: Today, start: () => Promise<void>): Child {
  const busy = signal(false);
  const error = signal("");
  const players = t.board.players;
  return h(
    "section",
    { class: "card hero day" },
    h("p", { class: "kicker" }, longDate(t.day)),
    h("h1", null, "Десет въпроса за днес"),
    h("p", { class: "muted" }, "По един от всяка тема, от лесен към труден. Едни и същи за всички, с един опит."),
    trail([], 10),
    h(
      "button",
      {
        class: "btn primary big",
        disabled: busy,
        onclick: async () => {
          busy.set(true);
          try {
            await start();
          } catch (err) {
            error.set((err as ApiError).message);
            busy.set(false);
          }
        },
      },
      "Започни",
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
    h(
      "p",
      { class: "day-meta" },
      // Who has played today, once someone has: a zero says only that the place is empty.
      players
        ? `Около 3 минути · ${players} ${players === 1 ? "човек е играл" : "души са играли"} днес`
        : "Около 3 минути",
    ),
  );
}

/** Time until the next day's questions (midnight in Bulgaria). */
function countdown(): Child {
  const left = signal(untilMidnight());
  const t = setInterval(() => left.set(untilMidnight()), 30_000);
  onCleanup(() => clearInterval(t));
  return h("p", { class: "muted day-next" }, () => `Нови въпроси след ${left()}.`);
}

function untilMidnight(): string {
  const now = new Date();
  const sofia = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Sofia" }));
  const minutes = 24 * 60 - (sofia.getHours() * 60 + sofia.getMinutes());
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} ч и ${minutes % 60} мин` : `${minutes} мин`;
}

/** Where „По-късно“ is kept, on this device. */
const laterKey = "keep-later";

/** A guest who keeps coming back is asked to keep their profile with an email (lib/keep.ts): a guest's game lives on
 * one device only. „По-късно“ asks again in a week. */
function keepCard(t: Today): Child {
  const u = user.peek();
  let laterAt = 0;
  try {
    laterAt = Number(localStorage.getItem(laterKey) ?? 0);
  } catch {
    // no storage here: ask
  }
  if (!u || !askToKeep({ email: u.email, streak: t.streak, level: t.level?.level ?? 1, laterAt, now: Date.now() }))
    return null;
  const shown = signal(true);
  return () =>
    shown() && !user()?.email
      ? h(
          "section",
          { class: "card keep-card" },
          h("h2", null, "Запази профила си"),
          h(
            "p",
            { class: "muted" },
            `${t.streak >= 3 ? `Серия от ${t.streak} дни!` : `Ниво ${t.level?.level}!`} Засега играта ти се пази само на това устройство. Добави имейл и ще я имаш навсякъде.`,
          ),
          signIn(),
          h(
            "button",
            {
              class: "link",
              type: "button",
              onclick: () => {
                try {
                  localStorage.setItem(laterKey, String(Date.now()));
                } catch {
                  // no storage: just for now
                }
                shown.set(false);
              },
            },
            "По-късно",
          ),
        )
      : null;
}
