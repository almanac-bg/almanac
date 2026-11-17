// Начало: where every game starts, on one short screen, and the day is its heart. At the top the player's streak and
// level (and, once, what came of the days just missed — a broken streak to win back while it can be — or, one line at a time, of a duel a friend has played, a friend's yes to an invite, a live duel left that went on); then the day's ten questions, the same for everyone, once, as the day's issue („Брой 6“, play/issue.go) (left half-way, where the player stopped and the way
// on, and the streak at stake while they wait; once played, how they went, the result to share, and tomorrow); the
// day's goals; and every other way to play a tap away: by topic, and — once a first game is finished —
// with others. The day's boards are in Класации. The game unfolds by the days played (play/unfold.go): a first day has
// the streak without the level, and no goals.

import { picture } from "../art/picture.ts";
import { news } from "../game/news.ts";
import { boardRow, hands, shareButton, summary } from "../game/results.ts";
import { getReady, playRun, shownHere, trail } from "../game/run.ts";
import { dayShareText, percent, rare } from "../game/share.ts";
import type { Board, Mark, Score, State } from "../game/types.ts";
import { type ApiError, api, tally } from "../lib/api.ts";
import { type Child, h, onCleanup, signal, slot } from "../lib/dom.ts";
import { reportProblem } from "../lib/errors.ts";
import { place } from "../lib/ordinal.ts";
import { needsHomeScreen, pushable, pushOn, turnOn } from "../lib/push.ts";
import { goBack, hold, release, title } from "../lib/router.ts";
import { feelKit } from "../lib/sound.ts";
import { dateWords, issueWords, onDay, weekday } from "../lib/words.ts";
import { dayInBulgaria } from "../lib/year.ts";
import { player, playing, user } from "../state.ts";
import {
  explain,
  failure,
  formatNumber,
  levelNumber,
  meter,
  type Open,
  pointsWords,
  reserveMeaning,
  reserveWords,
  stakeLine,
} from "../ui.ts";
import {
  type Accepted,
  acceptedLine,
  type ChallengeNews,
  challengesLine,
  type FriendPlayed,
  type Left,
  leftLine,
  playedLine,
} from "./duel.ts";
import { goalsCard } from "./goals.ts";
import { haveProfile, keepLine } from "./keep.ts";
import { modes } from "./modes.ts";
import { topics } from "./play.ts";
import { notice } from "./settings.ts";
import { yearCard } from "./year.ts";

export interface Today {
  day: string;
  /** The day's issue: its number from the first day of the day's ten (play/issue.go), the same for everyone. */
  issue?: number;
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
   * there's a player: they're new); always while its lobby is open or its games are on. */
  royal?: boolean;
  /** Роял's lobby is open or its games are on (for anyone, signed in or not). */
  royalNow?: boolean;
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
  /** A live game the player is in, under way (its screen left): the way back to it. */
  playing?: { kind: "duel" | "room" | "royal"; code?: string } | null;
  /** A friend has just played the duel the player started (told once). */
  duel?: FriendPlayed | null;
  /** A friend said yes to the player's invite, and a live duel they left: each told once (play/lines.go). */
  accepted?: Accepted | null;
  left?: Left | null;
  /** Who took the player's challenges since they last heard (play/challenges.go). */
  challenges?: ChallengeNews | null;
}

/** The day's ten played on another page (an invite's): their result there as Начало draws it (`before`: the day as
 * it stood before they were played), with that page's own card under it. */
export interface PlayedElsewhere {
  before: Today;
  run: State;
  card: () => Child;
}

export function today(_: string[] = [], elsewhere?: PlayedElsewhere) {
  title();
  // A profile just deleted, or a game just brought here, is said once, over the day.
  let bye = notice.peek();
  notice.set("");
  // The streak's mail links here with ?from=mail (server/streakmail.go): its reader has a profile.
  const fromMail = new URLSearchParams(location.search).get("from") === "mail";
  if (fromMail) history.replaceState(history.state, "", "/");
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  const load = async () => {
    try {
      const t = await api<Today>("GET", "/api/day");
      day = t.day;
      const run = t.run;
      // A question this tab was showing has its time running (a reload): straight back into it. Otherwise (another
      // device, or tab) the day left half-way waits on Начало for „Продължи“: no question's time starts without a tap.
      if (run && !run.done && run.question && shownHere(run.id))
        screen.show(() => playRun(run, (s) => home(t, s, true)));
      else screen.show(() => home(t, t.run, false));
    } catch (err) {
      screen.show(() => failure(err, load, null));
    }
  };
  // The day's ten (or the rest of them) start after the count every game has, which „Откажи“ backs out of: nothing
  // is sent before it runs out or „Започни сега“, so a tap by mistake costs nothing. What went wrong starting shows
  // on the day's card, back on Начало. They're played over Начало in an entry of their own (router.ts, hold): back,
  // mid-game, asks first, then comes to Начало, not out of the game.
  let counting = false;
  let failed = "";
  const back = (t: Today) => {
    counting = false;
    release();
    screen.show(() => home(t, t.run, false));
    scrollTo(0, 0);
  };
  const start = (t: Today) => () => {
    failed = "";
    hold(true);
    // A question showing (left so on another device): its time runs, so straight back to it, without a count.
    const left = t.run;
    if (left && !left.done && left.question) {
      screen.show(() => playRun(left, (s) => home(t, s, true)));
      scrollTo(0, 0);
      return;
    }
    counting = true;
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
        () => {
          counting = false;
          goBack("/");
        },
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
  if (elsewhere) {
    day = elsewhere.before.day;
    screen.show(() => home(elsewhere.before, elsewhere.run, true));
  } else load();
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
    const said = bye;
    bye = "";
    return h(
      "section",
      { class: "screen home" },
      said ? h("p", { class: "muted", role: "status" }, said) : null,
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
      // One line at a time: a live game of the player's going on; of others, a friend played the duel, said yes to
      // the invite, the duel left went on, or who took their challenges.
      playingLine(t.playing) ??
        playedLine(t.duel) ??
        acceptedLine(t.accepted) ??
        leftLine(t.left) ??
        challengesLine(t.challenges),
      // On a big screen the day leads the page with the topics under it, and the rest waits in a column beside it
      // (app.css); on a phone the two parts are one column, in this order.
      h(
        "div",
        { class: "home-main" },
        // Come from the streak's mail to a browser signed out: the way in comes first, open.
        fromMail && !user.peek()?.email ? haveProfile(load, undefined, true) : null,
        run?.done
          ? summary(
              run,
              [
                h("div", { class: "day-line" }, h("span", { class: "kicker" }, issueWords(t.issue, t.day)), () => {
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
                  () =>
                    dayShareText(t.day, t.issue, run.trail, run.total, fresh().streak, fresh().rarest, fresh().invite),
                  undefined,
                  true,
                  () => tally("share:day"),
                  true, // its link shows whose it is
                ),
              },
              // Tomorrow first, right under the buttons (when the next ten come, the streak, the reminder); then the
              // friends' day, and what the game earned.
              // Just played, the streak waits for the day as it is now, with today in it. Played on an invite's page,
              // that page's card comes first, in place of the friends' day.
              [
                elsewhere && run === elsewhere.run ? elsewhere.card() : null,
                tomorrowCard(
                  t.day,
                  () => (just && fresh() === t ? 0 : fresh().streak),
                  // A guest is asked to keep the game in a line of its own (screens/keep.ts).
                  keepLine(
                    () => (fresh().open?.xp ? 2 : 1),
                    () => fresh().streak,
                  ),
                ),
                elsewhere && run === elsewhere.run ? null : () => friendsDay(fresh()),
                just ? news(run.id, 0, round) : null,
              ],
              pointsWords(t.open),
              just,
            )
          : dayCard(t, start(t), run?.trail ?? [], failed),
        // Before a first game, a player who has a profile already (a new phone) signs in, a tap away.
        just || t.played || user.peek()?.email || fromMail ? null : haveProfile(load),
        // Mid-December into January: the year in the game, a tap away.
        yearCard(),
      ),
      h(
        "div",
        { class: "home-side" },
        // Just played, the goals it finished are told with its news; a first day has none (play/unfold.go).
        just || !t.open?.xp ? null : goalsCard(),
        // The ways to play with others wait for a first game finished: a new player starts with the day and a topic;
        // and Роял, in a player's first week, for its evenings to fill (play.NudgeRoyal). While its lobby is open or
        // its games are on, Роял shows to everyone, a new player too: a full evening is the best way to meet it.
        just || t.played
          ? modes(t.royal ? ["duel", "royal", "room"] : ["duel", "room"], "С други")
          : [
              t.royalNow ? modes(["royal"], "С други") : null,
              // A room's code from a friend or a teacher works from the first visit: the way in, in a line.
              h("p", { class: "day-next" }, h("a", { href: "/room" }, "Влез в стая с код")),
            ],
      ),
      topics(),
    );
  }
}

/** A live game the player is in goes on while its screen is away (a duel, a room's game, Роял): one quiet line above
 * the day, and the way back into it (its screen comes back to it by itself). */
function playingLine(p: Today["playing"]): Child {
  if (!p) return null;
  const [text, href] =
    p.kind === "duel"
      ? ["Дуелът ти продължава", "/duel/live"]
      : p.kind === "room"
        ? ["Играта в стаята продължава", `/r/${p.code}`]
        : ["Роял продължава", "/royal"];
  return h("p", { class: "streak-notice playing-notice", role: "status" }, text, h("a", { href }, "Върни се"));
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
 * where there's more of both. The reserve days sit on the flame's corner, each a tap from what they're for, so the
 * streak's words keep the chip's width (half a phone's, or the side column's on a wide screen). While the day's ten
 * wait, the streak is at stake: its flame unlit, its number still there, until the day played lights it (grow). */
function status(t: Today): HTMLElement {
  const days = t.streak;
  const lv = t.open?.xp ? t.level : undefined;
  const share = shareOf(lv);
  return h(
    "div",
    { class: "status-row" },
    h(
      "div",
      { class: "streak-wrap" },
      h(
        "a",
        { class: `status-item streak-chip${days ? (t.run?.done ? "" : " unlit") : " cold"}`, href: "/me" },
        h("span", { class: "status-icon" }, picture("flame", "flame status-flame")),
        h(
          "span",
          { class: "status-text" },
          h("b", { class: "status-n" }, String(days)),
          h("span", { class: "status-label" }, days === 1 ? "ден поред" : "дни поред"),
        ),
      ),
      // Beside the link, not in it: a tap on the shield says what it's for, and stays on Начало.
      t.reserve
        ? h(
            "span",
            { class: "status-reserve" },
            explain(
              [
                picture("shield", "reserve-pic"),
                h("b", { class: "num", "aria-hidden": "true" }, String(t.reserve)),
                h("span", { class: "sr" }, reserveWords(t.reserve)),
              ],
              reserveMeaning(t.reserve),
            ),
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
            h("b", { class: "status-n" }, levelNumber(lv.level)),
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
  if (streak && now.streak === was.streak + 1 && !streakMarks.includes(now.streak)) {
    // The flame stays as it was before the day (unlit, or cold without a streak) until its number rolls on: then it
    // lights, swelling once.
    const off = was.streak ? "unlit" : "cold";
    streak.classList.add(off);
    setTimeout(() => streak.classList.remove(off), delay);
    kit.streak(streak, now.streak, delay, hands());
  }
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

/** The day's ten, not played yet, as the day's issue: its dateline (the weekday and the issue over the date, set
 * large), what they are, and the gold button; or, left half-way (`marks`: how the questions answered went), where the
 * player stopped, the pips so far, and the way on from there; and what went wrong starting them (`error`). Before
 * play there are no pips: they'd measure nothing yet. */
function dayCard(t: Today, start: () => void, marks: Mark[], error: string): Child {
  const players = t.board.players;
  const at = marks.length;
  return h(
    "section",
    { class: "card hero day" },
    h(
      "header",
      { class: "masthead" },
      h(
        "p",
        { class: "kicker masthead-line" },
        h("span", null, weekday(t.day)),
        t.issue ? h("span", null, `Брой ${t.issue}`) : null,
      ),
      h("p", { class: "masthead-date" }, h("time", { datetime: t.day }, dateWords(t.day))),
    ),
    h(
      "div",
      { class: "intro" },
      h("h1", { class: "day-title" }, "Десет въпроса за днес"),
      h(
        "p",
        { class: "muted" },
        at
          ? `Следва въпрос ${at + 1} от 10. Довърши ги до полунощ.`
          : "По един от всяка тема, от лесен към труден. Едни и същи за всички, с един опит.",
      ),
      stakeLine(t.streak, t.reserve ?? 0),
    ),
    at ? trail(marks, 10, at) : null,
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

/** The day played, right under its result's buttons: tomorrow, in one quiet card. When the next ten come (midnight in
 * Bulgaria), what they make of the streak (`streak`: with today's), a guest's ask to keep the game (`keep`), and,
 * where it can come and isn't on yet, the reminder's ask. */
function tomorrowCard(day: string, streak: () => number, keep: Child): Child {
  const left = signal(untilMidnight());
  const t = setInterval(() => left.set(untilMidnight()), 30_000);
  onCleanup(() => clearInterval(t));
  return h(
    "section",
    { class: "card keep-card tomorrow" },
    h("h2", { class: "card-title" }, "Утре — нови десет"),
    h("p", { class: "muted" }, () => {
      const n = streak();
      return `След ${left()}.${n > 0 ? ` Изиграй ги и серията ти става ${n + 1}.` : ""}`;
    }),
    keep,
    remindAsk(day),
  );
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

/** The day played, in its card for tomorrow: shall we remind the player? Asked where notifications can come and aren't
 * on yet, at most three times and never twice in a day; on an iPhone in a browser tab, what it takes. */
function remindAsk(day: string): Child {
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
      : state() === "on"
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
            h(
              "div",
              { class: "remind-actions" },
              home ? null : h("button", { class: "btn", type: "button", onclick: yes }, "Напомняй ми"),
              h("button", { class: "link", type: "button", onclick: no }, home ? "Разбрах" : "Не сега"),
            ),
            () => error() && h("p", { class: "bad", role: "alert" }, error()),
          ];
}
