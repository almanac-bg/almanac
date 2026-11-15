// Начало: where every game starts, on one short screen, and the day is its heart. At the top the player's streak and
// level; then the day's ten questions, the same for everyone, once (left half-way, where the player stopped and the way
// on; once played, how they went, and the result to share); the day's goals; and every other way to play a tap away: by topic, and — once a first game is finished —
// with others. The day's boards are in Класации. The game unfolds by the days played (play/unfold.go): a first day has
// the streak without the level, and no goals.

import { picture } from "../art/picture.ts";
import { news } from "../game/news.ts";
import { shareButton, summary } from "../game/results.ts";
import { playRun, trail } from "../game/run.ts";
import { dayShareText } from "../game/share.ts";
import type { Board, Mark, State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal, slot } from "../lib/dom.ts";
import { reportProblem } from "../lib/errors.ts";
import { askToKeep } from "../lib/keep.ts";
import { place } from "../lib/ordinal.ts";
import { needsHomeScreen, pushable, pushOn, turnOn } from "../lib/push.ts";
import { title } from "../lib/router.ts";
import { onDay } from "../lib/words.ts";
import { dayInBulgaria } from "../lib/year.ts";
import { player, playing, user } from "../state.ts";
import { meter, type Open, pointsWords, reserveWords } from "../ui.ts";
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
  /** Days in a row to the next reserve day (0: they are full). */
  next?: number;
  /** A day just missed that a reserve day kept the streak through (the last 3 days). */
  kept?: string;
  /** A streak that just ended (the last 3 days): its days, and the day missed that ended it. */
  ended?: { days: number; on: string };
  /** The player's level, from all their XP (for a player). */
  level?: { level: number; xp: number; from: number; to: number };
  /** Whether the player has finished a game of any kind: until then Начало is the day and the topics only. */
  played?: boolean;
  /** Which of the game's systems the player has met: the level and the goals show once XP is open. */
  open?: Open;
  run: State | null;
  /** The day played: the right answer the fewest of its other players got (its place, their share right). */
  rarest?: { n: number; right: number } | null;
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
      // A question showing has its time running (a reload, a tab closed and opened again): straight back into it.
      // Otherwise the day left half-way waits on Начало for „Продължи“: no question's time starts without a tap.
      if (run && !run.done && run.question) screen.show(() => playRun(run, (s) => home(t, s, true)));
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
      streakNotice(t),
      // On a big screen the day leads the page with the topics under it, and the rest waits in a column beside it
      // (app.css); on a phone the two parts are one column, in this order.
      h(
        "div",
        { class: "home-main" },
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
              {
                main: shareButton("Сподели", () =>
                  dayShareText(t.day, run.trail, run.total, fresh().streak, fresh().rarest),
                ),
              },
              [just ? news(run.id) : null, remindCard(t.day), countdown()],
              pointsWords(t.open),
            )
          : dayCard(t, start(t), run?.trail ?? []),
        // Mid-December into January: the year in the game, a tap away.
        yearCard(),
        // A guest who keeps coming back is asked to keep their profile, once the day is played (the day comes first),
        // and not right after a game, which has its news.
        just || !run?.done ? null : keepCard(t),
      ),
      h(
        "div",
        { class: "home-side" },
        // Just played, the goals it finished are told with its news; a first day has none (play/unfold.go).
        just || !t.open?.xp ? null : goalsCard(),
        // The ways to play with others wait for a first game finished: a new player starts with the day and a topic.
        just || t.played ? modes(["duel", "royal", "room"], "С други") : null,
      ),
      topics(),
    );
  }
}

/** What came of the days just missed — a reserve day kept the streak, or none was left and it ended — said once on
 * this device, above the day. */
function streakNotice(t: Today): Child {
  const key = t.kept ? `kept:${t.kept}` : t.ended ? `ended:${t.ended.on}` : "";
  try {
    if (!key || localStorage.getItem("almanac.streakTold") === key) return null;
    localStorage.setItem("almanac.streakTold", key);
  } catch {
    // Storage refused (a private window): said on each visit, which is the lesser loss.
  }
  const text = t.kept
    ? `Резервен ден запази серията ти ${onDay(t.kept)}. Серия: ${t.streak === 1 ? "1 ден" : `${t.streak} дни`}.`
    : `Серията ти от ${t.ended?.days} дни прекъсна. ${t.run?.done ? "Днес започна нова." : "Днес започва нова."}`;
  return h("p", { class: "streak-notice", role: "status" }, picture(t.kept ? "shield" : "flame", "reserve-pic"), text);
}

/** The streak and (once XP is open: a first day has the streak only) the level, side by side: each a tap from Профил,
 * where there's more of both. */
function status(t: Today): Child {
  const days = t.streak;
  const lv = t.open?.xp ? t.level : undefined;
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

/** The day's ten, not played yet: what they are, and the gold button; or, left half-way (`marks`: how the questions
 * answered went), where the player stopped, and the way on from there. */
function dayCard(t: Today, start: () => Promise<void>, marks: Mark[]): Child {
  const busy = signal(false);
  const error = signal("");
  const players = t.board.players;
  const at = marks.length;
  return h(
    "section",
    { class: "card hero day" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, longDate(t.day)),
      h("h1", null, "Десет въпроса за днес"),
      h(
        "p",
        { class: "muted" },
        at
          ? `Следва въпрос ${at + 1} от 10. Довърши ги до полунощ.`
          : "По един от всяка тема, от лесен към труден. Едни и същи за всички, с един опит.",
      ),
    ),
    trail(marks, 10, at ? at : -1),
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
      at ? "Продължи" : "Започни",
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
    at
      ? null
      : h(
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

/** Where the reminder's asks are kept, on this device (notifications are a device's): how many, the last one's day. */
const remindKey = "almanac.remind-ask";

/** The day played, its result on Начало: shall we remind the player tomorrow? Asked where notifications can come and
 * aren't on yet, at most three times and never twice in a day; on an iPhone in a browser tab, what it takes. */
function remindCard(day: string): Child {
  let asked = { n: 0, day: "" };
  try {
    asked = { ...asked, ...JSON.parse(localStorage.getItem(remindKey) ?? "{}") };
  } catch {
    // no storage here: ask
  }
  const home = needsHomeScreen();
  if (asked.n >= 3 || asked.day === day || !(home || pushable())) return null;
  const keep = (n: number) => {
    try {
      localStorage.setItem(remindKey, JSON.stringify({ n, day }));
    } catch {
      // not kept: asked again next time
    }
  };
  const state = signal<"ask" | "on" | "gone">(home ? "ask" : "gone");
  const error = signal("");
  if (!home)
    pushOn().then(
      (on) => state.set(on ? "gone" : "ask"),
      () => {},
    );
  const yes = async () => {
    error.set("");
    try {
      const why = await turnOn();
      if (why) error.set(why);
      else {
        keep(3);
        state.set("on");
      }
    } catch (err) {
      reportProblem(`reminder ask: ${(err as Error).name}: ${(err as Error).message}`);
      error.set("Не успяхме. Опитай пак.");
    }
  };
  const no = () => {
    keep(asked.n + 1);
    state.set("gone");
  };
  return () =>
    state() === "gone"
      ? null
      : h(
          "section",
          { class: "card keep-card" },
          h("h2", null, "Утре — нови десет"),
          state() === "on"
            ? h("p", { class: "muted", role: "status" }, "Готово. Ще ти напомним в 19:00, ако въпросите още те чакат.")
            : [
                h(
                  "p",
                  { class: "muted" },
                  home
                    ? "На iPhone напомнянията идват, щом добавиш АЛМАНАХ към началния екран: Сподели → Добави към началния екран."
                    : "Да ти напомним, ако въпросите още те чакат? Веднъж на ден, в 19:00.",
                ),
                home ? null : h("button", { class: "btn", type: "button", onclick: yes }, "Напомняй ми"),
                h("button", { class: "link", type: "button", onclick: no }, home ? "Разбрах" : "Не сега"),
                () => error() && h("p", { class: "bad", role: "alert" }, error()),
              ],
        );
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
  // The level counts once it shows.
  const level = t.open?.xp ? (t.level?.level ?? 1) : 1;
  if (!u || !askToKeep({ email: u.email, streak: t.streak, level, laterAt, now: Date.now() })) return null;
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
