// Начало: where every game starts, on one short screen, and the day is its heart. At the top the player's streak and
// level (and, once, what came of the days just missed — a broken streak to win back while it can be — or of a duel a friend has played); then the day's ten questions, the same for everyone, once (left half-way, where the player stopped and the way
// on; once played, how they went, and the result to share); the day's goals; and every other way to play a tap away: by topic, and — once a first game is finished —
// with others. The day's boards are in Класации. The game unfolds by the days played (play/unfold.go): a first day has
// the streak without the level, and no goals.

import { picture } from "../art/picture.ts";
import { news } from "../game/news.ts";
import { boardRow, hands, shareButton, summary } from "../game/results.ts";
import { getReady, playRun, trail } from "../game/run.ts";
import { dayShareText, percent, rare } from "../game/share.ts";
import type { Board, Mark, Score, State } from "../game/types.ts";
import { type ApiError, api, tally } from "../lib/api.ts";
import { type Child, h, onCleanup, signal, slot } from "../lib/dom.ts";
import { reportProblem } from "../lib/errors.ts";
import { askToKeep } from "../lib/keep.ts";
import { place } from "../lib/ordinal.ts";
import { needsHomeScreen, pushable, pushOn, turnOn } from "../lib/push.ts";
import { title } from "../lib/router.ts";
import { feelKit } from "../lib/sound.ts";
import { onDay } from "../lib/words.ts";
import { dayInBulgaria } from "../lib/year.ts";
import { player, playing, user } from "../state.ts";
import { formatNumber, meter, type Open, pointsWords, reserveWords } from "../ui.ts";
import { type FriendPlayed, playedLine } from "./duel.ts";
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
  /** A streak that just ended and can be won back today (play/repair.go): its days, the day missed that ended it, and
   * whether today's ten and another game are played. */
  repair?: { days: number; on: string; day: boolean; other: boolean };
  /** The player's level, from all their XP (for a player). */
  level?: { level: number; xp: number; from: number; to: number };
  /** Whether the player has finished a game of any kind: until then Начало is the day and the topics only. */
  played?: boolean;
  /** Whether Роял is among the ways to play with others: not for a new player while its evenings are thin (nor before
   * there's a player: they're new). */
  royal?: boolean;
  /** Which of the game's systems the player has met: the level and the goals show once XP is open. */
  open?: Open;
  run: State | null;
  /** The day played: the right answer the fewest of its other players got (its place, their share right). */
  rarest?: { n: number; right: number } | null;
  board: Board;
  /** The day among the player and their friends, best first: once a friend has played it (null before). */
  friends?: Score[] | null;
  /** While no friend has played: whether the player has any friends at all. */
  befriended?: boolean;
  /** The day played: the player's invite link, which their shared result ends with. */
  invite?: string;
  /** A friend has just played the duel the player started (told once). */
  duel?: FriendPlayed | null;
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
  // The day's ten (or the rest of them) start after the count every game has, which „Откажи“ backs out of: nothing
  // is sent before it runs out or „Започни сега“, so a tap by mistake costs nothing. What went wrong starting shows
  // on the day's card, back on Начало.
  let counting = false;
  let failed = "";
  const back = (t: Today) => {
    counting = false;
    screen.show(() => home(t, t.run, false));
    scrollTo(0, 0);
  };
  const start = (t: Today) => () => {
    counting = true;
    failed = "";
    screen.show(() =>
      getReady(
        "Въпросите на деня",
        async () => {
          screen.show(() => h("p", { class: "muted" }, "…"));
          try {
            await player();
            const s = await api<State>("POST", "/api/day", {});
            counting = false;
            screen.show(() => playRun(s, (end) => home(t, end, true)));
          } catch (err) {
            failed = (err as ApiError).message;
            back(t);
          }
        },
        () => back(t),
      ),
    );
    scrollTo(0, 0);
  };
  // A new day while the screen stays open (a phone left on Начало overnight): the new day's ten, not yesterday's
  // result with a countdown to a day that has come. Never in the middle of a game, nor of its count.
  let day = "";
  const newDay = () => {
    if (day && !document.hidden && !playing.peek() && !counting && dayInBulgaria() !== day) load();
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
    // Just played: the streak, the level and the place it made, as they are now. The streak grown to one of its round
    // numbers is the game's big news (news.ts: a sheet of its own); otherwise it rolls on in its chip, after the
    // result's moment has landed (feel.ts).
    const fresh = signal<Today>(t);
    const now = just ? api<Today>("GET", "/api/day") : null;
    now?.then(fresh.set, () => {});
    const round = now?.then(
      (f) => (f.streak > t.streak && streakMarks.includes(f.streak) ? f.streak : 0),
      () => 0,
    );
    const since = performance.now();
    let grown = false;
    return h(
      "section",
      { class: "screen home" },
      // A new player, before a first game finished, sees the day and the topics only.
      () => {
        if (!user() || !(just || t.played)) return null;
        const f = fresh();
        const row = status(f);
        if (f !== t && !grown) {
          grown = true;
          grow(row, t, f, Math.max(0, since + 1100 - performance.now()));
        }
        return row;
      },
      // A streak that can be won back today, as it stands (the day just played may have done it); else what came of
      // the days just missed, once.
      t.repair ? () => repairCard(fresh().repair) : streakNotice(t),
      playedLine(t.duel),
      // On a big screen the day leads the page with the topics under it, and the rest waits in a column beside it
      // (app.css); on a phone the two parts are one column, in this order.
      h(
        "div",
        { class: "home-main" },
        run?.done
          ? summary(
              run,
              [
                h("div", { class: "day-line" }, h("span", { class: "kicker" }, longDate(t.day)), () => {
                  const b = fresh().board;
                  return b.place
                    ? h("a", { class: "place-line", href: "/ranks" }, `${place(b.place, b.players)} днес`)
                    : null;
                }),
                // From ten players, how many right is usual today; and the right answer few others got, in gold.
                () => {
                  const avg = fresh().board.average;
                  const lines = [
                    avg ? h("p", { class: "crowd-says" }, `Средно днес: ${formatNumber(avg, 0.1)} от 10.`) : null,
                    rareLine(fresh().rarest),
                  ];
                  return lines.some(Boolean) ? h("div", null, lines) : null;
                },
              ],
              // The result is the one to share: „Сподели“ is the gold button, right under it; then what it earned.
              {
                main: shareButton(
                  "Сподели",
                  () => dayShareText(t.day, run.trail, run.total, fresh().streak, fresh().rarest, fresh().invite),
                  undefined,
                  true,
                  () => tally("share:day"),
                ),
              },
              [() => friendsDay(fresh()), just ? news(run.id, 0, round) : null, remindCard(t.day), countdown()],
              pointsWords(t.open),
              just,
            )
          : dayCard(t, start(t), run?.trail ?? [], failed),
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
        // The ways to play with others wait for a first game finished: a new player starts with the day and a topic;
        // and Роял, in a player's first week, for its evenings to fill (play.NudgeRoyal).
        just || t.played ? modes(t.royal ? ["duel", "royal", "room"] : ["duel", "room"], "С други") : null,
      ),
      topics(),
    );
  }
}

/** Where the last streak news told on Начало is kept, on this device: told once. */
const streakTold = "almanac.streakTold";

/** What came of the days just missed — a reserve day kept the streak, or none was left and it ended — said once on
 * this device, above the day. */
function streakNotice(t: Today): Child {
  const key = t.kept ? `kept:${t.kept}` : t.ended ? `ended:${t.ended.on}` : "";
  try {
    if (!key || localStorage.getItem(streakTold) === key) return null;
    localStorage.setItem(streakTold, key);
  } catch {
    // Storage refused (a private window): said on each visit, which is the lesser loss.
  }
  const text = t.kept
    ? `Резервен ден запази серията ти ${onDay(t.kept)}. Серия: ${t.streak === 1 ? "1 ден" : `${t.streak} дни`}.`
    : `Серията ти от ${t.ended?.days} дни прекъсна. ${t.run?.done ? "Днес започна нова." : "Днес започва нова."}`;
  return h("p", { class: "streak-notice", role: "status" }, picture(t.kept ? "shield" : "flame", "reserve-pic"), text);
}

/** A streak just ended that can be won back today (play/repair.go): the day's ten and one more game, and what's left of
 * them. Shown while it's on offer; counted once on this device, which then won't hear later that the streak ended. */
function repairCard(r: Today["repair"]): Child {
  if (!r) return null;
  try {
    if (localStorage.getItem("almanac.repairOffered") !== r.on) {
      localStorage.setItem("almanac.repairOffered", r.on);
      localStorage.setItem(streakTold, `ended:${r.on}`);
      tally("repair:offered");
    }
  } catch {
    // no storage here: counted each time
  }
  const left = r.day
    ? "Остава още една игра днес и серията се връща."
    : r.other
      ? "Остават въпросите на деня и серията се връща."
      : "Върни я: изиграй днес въпросите на деня и още една игра.";
  return h(
    "section",
    { class: "card keep-card" },
    h("h2", null, `Серията ти от ${r.days} дни прекъсна`),
    h("p", { class: "muted" }, left),
  );
}

/** The streak and (once XP is open: a first day has the streak only) the level, side by side: each a tap from Профил,
 * where there's more of both. The reserve days sit on the flame's corner, so the streak's words keep the chip's width
 * (half a phone's, or the side column's on a wide screen). */
function status(t: Today): HTMLElement {
  const days = t.streak;
  const lv = t.open?.xp ? t.level : undefined;
  const share = shareOf(lv);
  return h(
    "div",
    { class: "status-row" },
    h(
      "a",
      { class: days ? "status-item streak-chip" : "status-item streak-chip cold", href: "/me" },
      h(
        "span",
        { class: "status-icon" },
        picture("flame", "flame status-flame"),
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
      h(
        "span",
        { class: "status-text" },
        h("b", { class: "status-n" }, String(days)),
        h("span", { class: "status-label" }, days === 1 ? "ден поред" : "дни поред"),
      ),
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

/** How far into its level a player is, in percent. */
const shareOf = (lv?: Today["level"]) =>
  lv && lv.to > lv.from ? Math.round((100 * (lv.xp - lv.from)) / (lv.to - lv.from)) : 0;

/** The streak's round numbers (the achievements' and a year): reached, they're the game's big news. */
const streakMarks = [3, 7, 30, 100, 365];

/** The streak and the level just grown by the day played (`was` before it, `now` after), moved there in their chips
 * once the result has landed (`delay`): the streak's number rolls on (unless a round one, told in a sheet), the
 * level's bar fills. Without the game's feel loaded, or with less motion, they are simply as they are. */
function grow(row: HTMLElement, was: Today, now: Today, delay: number): void {
  const kit = feelKit();
  if (!kit) return;
  const streak = row.querySelector<HTMLElement>(".streak-chip");
  if (streak && now.streak === was.streak + 1 && !streakMarks.includes(now.streak))
    kit.streak(streak, now.streak, delay, hands());
  const chip = row.querySelector<HTMLElement>(".level-chip");
  if (chip && was.level && now.level && now.open?.xp)
    kit.level(
      chip,
      { level: was.level.level, share: shareOf(was.level), left: `още ${was.level.to - was.level.xp} XP` },
      { level: now.level.level, share: shareOf(now.level), left: `още ${now.level.to - now.level.xp} XP` },
      delay + 200,
      hands(),
    );
}

/** The day's ten, not played yet: what they are, and the gold button; or, left half-way (`marks`: how the questions
 * answered went), where the player stopped, and the way on from there; and what went wrong starting them (`error`). */
function dayCard(t: Today, start: () => void, marks: Mark[], error: string): Child {
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
    h("button", { class: "btn primary big", onclick: start }, at ? "Продължи" : "Започни"),
    error ? h("p", { class: "bad", role: "alert" }, error) : null,
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
    friendsPlayed(t),
  );
}

/** The right answer of the day played that the fewest of its other players got, told in gold if few did: the line
 * the shared result carries, on the screen. */
function rareLine(r?: { n: number; right: number } | null): Child {
  if (!r || r.right > rare) return null;
  const who = r.right ? `го знаят само ${percent(r.right)} от играчите` : "не го знае никой друг";
  return h("p", { class: "crowd-says rare" }, `Позна въпрос ${r.n + 1}: днес ${who}.`);
}

/** The friends' day beside the result: the best five (the player's own row in place of the fifth if further down),
 * each with how their ten went, and the way to them all; for a player without friends, one quiet line to invite one.
 * Shown once the day as fetched has the player on it. */
function friendsDay(t: Today): Child {
  const all = t.friends ?? [];
  if (!all.length)
    return t.befriended === false
      ? h(
          "p",
          { class: "day-next" },
          h("a", { href: "/friends" }, "Покани някого и сравнявайте резултатите си всеки ден."),
        )
      : null;
  const mine = all.findIndex((s) => s.me);
  if (mine < 0) return null;
  const rows = all.slice(0, 5).map((s, i) => ({ s, i }));
  if (mine >= 5) rows[4] = { s: all[mine] as Score, i: mine };
  return h(
    "section",
    { class: "board" },
    h("h2", null, "Приятелите ти днес"),
    h(
      "ol",
      null,
      rows.map(({ s, i }) => {
        const row = boardRow(i + 1, s.name, [String(s.rights), h("small", { class: "sub" }, " от 10")], {
          me: s.me,
          gap: i > 4,
          look: s,
          tag: s.tag,
        });
        if (s.trail) row.append(trail(s.trail, 10));
        return row;
      }),
    ),
    all.length > 5 ? h("p", { class: "board-note" }, h("a", { href: "/ranks#friends" }, "Всички")) : null,
  );
}

/** Before the day is played, the friends who have played it: names only, never how they went. */
function friendsPlayed(t: Today): Child {
  const names = (t.friends ?? []).filter((s) => !s.me).map((s) => s.name);
  if (!names.length) return null;
  const [first, second] = names;
  const text =
    names.length === 1
      ? `${first} вече изигра днешните въпроси.`
      : names.length === 2
        ? `${first} и ${second} вече изиграха днешните въпроси.`
        : `${first} и още ${names.length - 1} приятели вече изиграха днешните въпроси.`;
  return h("p", { class: "day-meta" }, text);
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
  let asked = { n: 0, day: "", shown: "" };
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
  // Counted once a day on a device (play/measure.go), however often Начало is drawn.
  const shown = () => {
    if (asked.shown === day) return;
    tally(home ? "pushask:home" : "pushask:shown");
    try {
      localStorage.setItem(remindKey, JSON.stringify({ ...asked, shown: day }));
    } catch {
      // counted again next time
    }
  };
  const state = signal<"ask" | "on" | "gone">(home ? "ask" : "gone");
  const error = signal("");
  if (home) shown();
  else
    pushOn().then(
      (on) => {
        state.set(on ? "gone" : "ask");
        if (!on) shown();
      },
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
        tally("pushask:yes");
      }
    } catch (err) {
      reportProblem(`reminder ask: ${(err as Error).name}: ${(err as Error).message}`);
      error.set("Не успяхме. Опитай пак.");
    }
  };
  const no = () => {
    keep(asked.n + 1);
    state.set("gone");
    if (!home) tally("pushask:no");
  };
  return () =>
    state() === "gone"
      ? null
      : h(
          "section",
          { class: "card keep-card" },
          h("h2", null, "Утре — нови десет"),
          state() === "on"
            ? h(
                "p",
                { class: "muted", role: "status" },
                "Готово. Ще ти напомним около часа, в който играеш, ако въпросите още те чакат.",
              )
            : [
                h(
                  "p",
                  { class: "muted" },
                  home
                    ? "На iPhone напомнянията идват, щом добавиш АЛМАНАХ към началния екран: Сподели → Добави към началния екран."
                    : "Да ти напомним, ако въпросите още те чакат? Веднъж на ден, около часа, в който играеш.",
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
