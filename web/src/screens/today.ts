// Начало: where every game starts, on one short screen, and the day is its heart. At the top the player's streak and
// level (and, once, what came of the days just missed — a broken streak to win back while it can be, with the way to,
// or a welcome back after days away — or, one line at a time, of a duel a friend has played, a friend's yes to an
// invite, a live duel left that went on); then the day's ten questions, the same for everyone, once, as the day's issue
// („Брой 6“, play/issue.go) (while they wait, how yesterday's ended; left half-way, where the player stopped and the
// way on, and the streak at stake while they wait; once played, as it lands, how they went and the one gold thing to
// do next (game/gold.ts: the result to share, when it's worth it; else another game, where a goal points), the goals
// still open, tomorrow, and where the day leaves the league and the second chance; on a later visit, the day played in
// one short card, another game the gold thing to do); the day's goals; and every other way to play a tap away: by
// topic, and — once a first game is finished — with others. The day's boards are in Класации. The game unfolds by the
// days played (play/unfold.go): a first day has the streak without the level, and no goals.

import { picture } from "../art/picture.ts";
import { type DayGold, dayGold, nextGame, streakMarks } from "../game/gold.ts";
import { news } from "../game/news.ts";
import { boardRow, hands, landed, nextSteps, shareButton, summary } from "../game/results.ts";
import { getReady, playRun, shownHere, starting, trail } from "../game/run.ts";
import { closeWords, dayShareText, percent, rare } from "../game/share.ts";
import { standing } from "../game/standing.ts";
import type { Board, Mark, Score, State } from "../game/types.ts";
import { api, errorText, serverNow, tally } from "../lib/api.ts";
import { inApp } from "../lib/app.ts";
import { boot } from "../lib/boot.ts";
import { type Child, h, onCleanup, signal, slot } from "../lib/dom.ts";
import { reportProblem } from "../lib/errors.ts";
import { type RemindAsks, remindAnswered, remindAsks, remindShown } from "../lib/keep.ts";
import { pushable, pushOn, turnOn } from "../lib/push.ts";
import { goBack, hold, release, title } from "../lib/router.ts";
import { feelKit } from "../lib/sound.ts";
import { dateWords, issueWords, onDay, weekday } from "../lib/words.ts";
import { dayInBulgaria, yearNow } from "../lib/year.ts";
import { categories, met, notice, player, playing, user } from "../state.ts";
import {
  explain,
  failure,
  formatNumber,
  levelNumber,
  meter,
  type Open,
  pointsWords,
  repairWords,
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
import { type Goals, goalsCard, loadGoals, openGoals } from "./goals.ts";
import { app, haveProfile, keepLine, keepStake, mailAsk } from "./keep.ts";
import { leagueNote } from "./league.ts";
import { clock, modes } from "./modes.ts";
import { type PastNext, topics } from "./play.ts";

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
  /** A streak that just ended and can be won back today (play/repair.go): its days, the day missed that ended it,
   * whether today's ten are played, and each issue missed, played since or not (`open`: playable yet), and those
   * still to play as a sentence says them (`words`: „пропуснатия брой от 17 ноември“; "" for none). */
  repair?: {
    days: number;
    on: string;
    day: boolean;
    missed: { day: string; issue: number; done: boolean; open: boolean }[];
    words: string;
  };
  /** The newest past issue the player hasn't played (play.LatestPast): where „Още десет“ goes after the day. */
  past?: PastNext | null;
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
  /** A live game the player is in, under way (its screen left), a room's by its code; or a seat in Роял's lobby, with
   * its start (`starts`): the way back to it. */
  playing?: { kind: "duel" | "room" | "royal"; code?: string; starts?: number } | null;
  /** A friend has just played the player's challenge (told once). */
  duel?: FriendPlayed | null;
  /** A friend said yes to the player's invite, and a live duel they left: each told once (play/lines.go). */
  accepted?: Accepted | null;
  left?: Left | null;
  /** A game that ended without its result on screen (the day's last question let run out, a game left at its end):
   * its news, told here once (play/told.go). */
  untold?: number;
  /** The day played: how many of its questions got wrong will wait for a second chance, in how many days (sent when
   * there'll be a game of them: play.MistakesFrom). */
  misses?: { n: number; days: number };
  /** Who took the player's challenges since they last heard (play/challenges.go). */
  challenges?: ChallengeNews | null;
  /** While today's ten wait: how yesterday's ended for the player, once its board is final (play.YesterdayOf). */
  yesterday?: { day: string; issue: number; rights: number; place: number; players: number } | null;
  /** Back after days away, the streak ended since (play.BackFrom): the last day played and the longest streak, said
   * once. */
  back?: { last: string; best: number };
}

/** The day as Начало's page came with it (server/pages.go): its first draw, without asking; every later one asks. */
let inPage = boot.day as Today | undefined;

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
  // The game's mails link here with ?from=mail (server/streakmail.go, daymail.go): their reader has a profile.
  const fromMail = new URLSearchParams(location.search).get("from") === "mail";
  if (fromMail) history.replaceState(history.state, "", "/");
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  const load = async () => {
    try {
      const t = inPage ?? (await api<Today>("GET", "/api/day"));
      inPage = undefined;
      met(t.open);
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
          screen.show(starting);
          try {
            await player();
            const s = await api<State>("POST", "/api/day", {});
            counting = false;
            screen.show(() => playRun(s, (end) => home(t, end, true)));
          } catch (err) {
            failed = errorText(err);
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
  // result with a countdown to a day that has come. Never in the middle of a game, nor of its count. The day is the
  // server's, by its clock: a phone whose clock is a day off would otherwise load the day again every minute.
  let day = "";
  const newDay = () => {
    const now = dayInBulgaria(new Date(serverNow()));
    if (day && !document.hidden && !playing.peek() && !counting && now !== day) load();
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
    // Just played: the streak, the level and the place it made, as they are now. The moments come one after another,
    // never over each other: the result lands, then the streak rolls on in its chip and the level's bar fills (feel.ts),
    // and only then what's big (news.ts: a sheet), which is the streak itself when it reaches one of its round numbers.
    const fresh = signal<Today>(t);
    const now = just ? api<Today>("GET", "/api/day") : null;
    now?.then(fresh.set, () => {});
    let growing: Promise<void> | null = null;
    const streak = now && {
      round: now.then(
        (f) => (f.streak > t.streak && streakMarks.includes(f.streak) ? f.streak : 0),
        () => 0,
      ),
      // A reserve day the day's ten just earned (play/runs.go: the streak's third day, the first), told with the
      // streak's round number.
      reserve: now.then(
        (f) => (f.reserve ?? 0) > (t.reserve ?? 0),
        () => false,
      ),
      // Once the day as it is now has come and drawn the chips (signals run at once): their growing, if any.
      grown: now.then(
        () => growing ?? undefined,
        () => undefined,
      ),
    };
    // Or a profile just signed in to here (haveProfile): what came of it.
    const said = bye || notice.peek();
    bye = "";
    notice.set("");
    // The day's goals (shown once XP is open: play/unfold.go; the day just played may open it): what's next after the
    // day, and where another game goes: a goal's topic, else the newest past issue not played (Минали броеве took the
    // place of the game of every topic), else a topic, a new one each day.
    const goals = signal<Goals | null>(null);
    if (user.peek() && (run?.done || t.repair)) loadGoals().then(goals.set, () => {});
    const next = () => {
      const past = fresh().past;
      const topic = categories[Number(t.day.replaceAll("-", "")) % categories.length]?.id ?? "";
      return nextGame(
        fresh().open?.xp ? (goals()?.goals ?? []) : [],
        past ? `/issues/${past.issue}` : `/play/${topic}`,
      );
    };
    // The day played: in full as it lands (or on its invite's page, or when its result was never on screen: what it
    // earned is told with it); on a later visit, one short card (dayDone), with the ways to play right under it.
    const full = !!run?.done && (just || !!elsewhere || t.untold === run.id);
    // Once played, a streak to win back has its card under the result, as it stands (the day just played may have
    // done it, or half of it).
    const repairing = t.repair ? () => repairCard(fresh().repair) : null;
    const tomorrow = run?.done
      ? tomorrowCard(
          t.day,
          () => (just && fresh() === t ? 0 : fresh().streak),
          // A guest is asked to keep the game (screens/keep.ts): what it risks till then.
          keepStake(
            () => (fresh().open?.xp ? 2 : 1),
            () => fresh().streak,
          ),
          () => fresh().repair,
        )
      : null;
    return h(
      "section",
      { class: "screen home" },
      said ? h("p", { class: "muted", role: "status" }, said) : null,
      // A new player, before a first game finished, sees the day and the topics only.
      () => {
        if (!user() || !(just || t.played)) return null;
        const f = fresh();
        const row = status(f);
        if (row && f !== t && !growing && run)
          growing = grow(
            row,
            t,
            f,
            landed(run.id).then(() => wait(200)),
          );
        return row;
      },
      // On a big screen the day leads the page with the topics under it, and the rest waits in a column beside it
      // (app.css); on a phone the two parts are one column, in this order.
      h(
        "div",
        { class: "home-main" },
        // A streak that can be won back today, as it stands, while the day's ten wait (once played, its card is under
        // the result: the day just played may have done it); else what came of the days just missed, once.
        t.repair ? (run?.done ? null : () => repairCard(fresh().repair)) : streakNotice(t),
        // One line at a time: a live game of the player's going on; of others, a friend played their challenge, said
        // yes to the invite, the duel left went on, or who else took their challenges.
        playingLine(t.playing) ??
          playedLine(t.duel) ??
          acceptedLine(t.accepted) ??
          leftLine(t.left) ??
          challengesLine(t.challenges),
        // Come from the streak's mail to a browser signed out: the way in comes first, open.
        fromMail && !user.peek()?.email ? haveProfile(load, undefined, true) : null,
        // While today's ten wait, how yesterday's ended: the day before closes as the next begins.
        run?.done ? null : yesterdayLine(t),
        run?.done && !full
          ? [
              // A later visit: the day played as one short card, and the ways to play right under it.
              dayDone(t, run, fresh, next),
              repairing,
              tomorrow,
              () => (fresh().open?.league ? leagueNote() : null),
              () => missesLine(fresh().misses),
            ]
          : run?.done
            ? summary(
                run,
                [
                  h("div", { class: "day-line" }, h("span", { class: "kicker" }, issueWords(t.issue, t.day)), () =>
                    placeLink(fresh()),
                  ),
                  // How it went among everyone, from ten players (game/standing.ts), else how many right is usual
                  // today; and the right answer few others got, in gold.
                  () => {
                    const lines = [crowdSays(fresh()), rareLine(fresh().rarest)];
                    return lines.some(Boolean) ? h("div", null, lines) : null;
                  },
                ],
                // Right under it, what to do next: one gold action (game/gold.ts), „Сподели“ plain when it isn't.
                dayNext(t, run, just, fresh, next, now),
                // A streak half won back, its card with the gold way on; the goals still open, just played (else
                // they're in their card); tomorrow (when the next ten come, the streak, the reminder); where the day
                // leaves the league, and what waits for a second chance; then the friends' day, and what the game
                // earned (a day whose result was never on screen: told now, once). Just played, the streak waits for
                // the day as it is now, with today in it. Played on an invite's page, that page's card comes first, in
                // place of the friends' day.
                [
                  elsewhere && run === elsewhere.run ? elsewhere.card() : null,
                  repairing,
                  just ? () => (fresh().open?.xp ? openGoals(goals) : null) : null,
                  tomorrow,
                  () => (fresh().open?.league ? leagueNote() : null),
                  () => missesLine(fresh().misses),
                  elsewhere && run === elsewhere.run ? null : () => friendsDay(fresh()),
                  just ? news(run.id, 0, streak ?? undefined) : untold(t, run.id),
                ],
                pointsWords(t.open),
                just,
              )
            : dayCard(t, start(t), run?.trail ?? [], failed),
        // Before a first game, a player who has a profile already (a new phone) signs in, a tap away; and a room's code
        // from a friend works from the first visit: the way in, in a line. Both under the day, so that a new player's
        // Начало is one column, on a big screen too.
        just || t.played || user.peek()?.email || fromMail ? null : haveProfile(load),
        just || t.played ? null : h("p", { class: "day-next" }, h("a", { href: "/room" }, "Влез в стая с код")),
        // Mid-December into January: the year in the game, a tap away.
        yearCard(),
      ),
      h(
        "div",
        { class: "home-side" },
        // Another game whose result was never on screen: what it earned, told here once, before what's next.
        just ? null : untold(t),
        // Just played, the goals it finished are told with its news; a first day has none (play/unfold.go).
        just || !t.open?.xp ? null : goalsCard(),
        // The ways to play with others wait for a first game finished: a new player starts with the day and a topic;
        // and Роял, in a player's first week, for its evenings to fill (play.NudgeRoyal). While its lobby is open or
        // its games are on, Роял shows to everyone, a new player too: a full evening is the best way to meet it.
        just || t.played
          ? modes(t.royal ? ["duel", "royal", "room"] : ["duel", "room"], "С други")
          : t.royalNow
            ? modes(["royal"], "С други")
            : null,
        // A later visit: the friends' day after the ways to play (beside the day on a big screen).
        run?.done && !full ? () => friendsDay(fresh()) : null,
      ),
      topics(t.past),
    );
  }
}

/** Where the day's result was shared last, on this device: /admin counts a day's share once on a device. */
const sharedKey = "almanac.sharedDay";

/** What to do next under the day's result: the one gold action (game/gold.ts) — „Сподели“ for a result worth sharing,
 * as it lands (`just`); else another game, to where a goal points (`next`); none while a broken streak is half won
 * back, whose card has it — and „Сподели“ plain when it isn't gold. The rule is weighed once, as the result is drawn,
 * so that the gold doesn't move under the player's thumb; just played, once the day as it is now is in (`now`), as
 * the right answer few others got is known only once the day is played (and if it doesn't come, on what's known). */
function dayNext(
  t: Today,
  run: State,
  just: boolean,
  fresh: () => Today,
  next: () => string,
  now: Promise<Today> | null,
): { main: Child; also?: Child[] } {
  const weigh = (d: Today) =>
    dayGold({
      rights: run.rights,
      streak: just ? t.streak + 1 : t.streak,
      rare: !!d.rarest && d.rarest.right <= rare,
      just,
      repairing: !!t.repair?.missed.some((m) => !m.done),
    });
  const gold = signal<DayGold | null>(now ? null : weigh(t));
  now?.then(
    (d) => gold.set(weigh(d)),
    () => gold.set(weigh(t)),
  );
  const share = (primary: boolean) =>
    shareButton(
      "Сподели",
      () => dayShareText(t.day, t.issue, run.trail, run.total, fresh().streak, fresh().rarest, fresh().invite),
      undefined,
      primary,
      () => {
        // Counted once a day on a device (/admin's share of the days finished that were shared), however often sent.
        let before = false;
        try {
          before = localStorage.getItem(sharedKey) === t.day;
          localStorage.setItem(sharedKey, t.day);
        } catch {
          // not kept: gold again next time
        }
        if (!before) tally("share:day", t.day); // its day: shared after midnight, it's yesterday's
      },
      true, // its link shows whose it is
    );
  return {
    main: () => {
      const g = gold();
      if (g === "share") return share(true);
      return g === "next" ? () => h("a", { class: "btn primary big", href: next() }, "Още десет") : null;
    },
    also: [() => (gold() && gold() !== "share" ? share(false) : null)],
  };
}

/** The day played: how many of its questions got wrong will wait for a second chance, and when, in a quiet line. */
function missesLine(m: Today["misses"]): Child {
  if (!m?.n) return null;
  const when = `във Втори шанс след ${m.days} ${m.days === 1 ? "ден" : "дни"}`;
  return h(
    "p",
    { class: "day-next" },
    m.n === 1 ? `Един от днешните въпроси ще те чака ${when}.` : `${m.n} от днешните въпроси ще те чакат ${when}.`,
  );
}

/** The day played among everyone (game/standing.ts): the way to the day's board, said by the place where it's worth
 * saying. */
function placeLink(t: Today): Child {
  const s = standing(t.board.place, t.board.players, !t.open?.league);
  return s ? h("a", { class: "place-line", href: "/ranks" }, s.place ? `${s.place} днес` : "Класацията на деня") : null;
}

/** How the day played went among everyone: the share of players it did better than, where that's said
 * (game/standing.ts), and, from ten players, how many right is usual today (`one`: only the first of them). */
function crowdSays(t: Today, one = false): Child {
  const lead = standing(t.board.place, t.board.players, !t.open?.league)?.lead;
  const avg = t.board.average;
  const lines = [
    lead ? h("p", { class: "crowd-says" }, lead) : null,
    avg && !(one && lead) ? h("p", { class: "crowd-says" }, `Средно днес: ${formatNumber(avg, 0.1)} от 10.`) : null,
  ].filter(Boolean);
  return lines.length ? lines : null;
}

/** While today's ten wait, how yesterday's ended for the player, in one quiet line: a way to that day's final board
 * (Класации' „Вчера“), with the place where it's worth saying (game/standing.ts). */
function yesterdayLine(t: Today): Child {
  const y = t.yesterday;
  if (!y) return null;
  const at = standing(y.place, y.players, !t.open?.league)?.place;
  return h(
    "p",
    { class: "day-next yesterday-line" },
    h(
      "a",
      { href: "/ranks#yesterday" },
      at ? `Вчера: ${y.rights} от 10 · ${at}` : `Вчера: ${y.rights} от 10 · Как завърши брой ${y.issue}`,
    ),
  );
}

/** The day played, on a later visit (its moment is over): one short card — its dateline and place, the score and its
 * points, the pips — with the gold way to another game under it (or none while a broken streak is half won back, whose
 * card has it), „Сподели“ plain, and the questions gone over on their own page. */
function dayDone(t: Today, run: State, fresh: () => Today, next: () => string): Child {
  const ways = dayNext(t, run, false, fresh, next, null);
  return h(
    "section",
    { class: "card day-done" },
    h("div", { class: "day-line" }, h("span", { class: "kicker" }, issueWords(t.issue, t.day)), placeLink(t)),
    h(
      "p",
      { class: "day-done-score" },
      h("b", { class: "day-done-n" }, String(run.rights)),
      h("span", { class: "num-word" }, " от "),
      h("b", { class: "day-done-of" }, String(run.total - (run.void ?? 0))),
      h("span", { class: "num-word" }, closeWords(run.trail)),
      h("span", { class: "day-done-points" }, `${formatNumber(run.points)} ${run.points === 1 ? "точка" : "точки"}`),
    ),
    crowdSays(t, true),
    trail(run.trail, run.total),
    nextSteps(ways.main, [
      h("a", { class: "btn", href: `/games/${run.id}` }, "Прегледай въпросите"),
      ...(ways.also ?? []),
    ]),
  );
}

/** The news of a game whose result was never on screen (`t.untold`; of `run` only, if given: the day's, under its
 * result; another's under „От последната ти игра“), told once: the next drawing of Начало has none. */
function untold(t: Today, run?: number): Child {
  const id = t.untold;
  if (!id || (run !== undefined && id !== run)) return null;
  t.untold = undefined;
  return news(id, 0, undefined, { title: run ? "" : "От последната ти игра" });
}

/** A live game the player is in goes on while its screen is away (a duel, a room's game, Роял), or waits for them (a
 * seat in Роял's lobby, kept while they play something else): one quiet line above the day, and the way back into it
 * (its screen comes back to it by itself). */
function playingLine(p: Today["playing"]): Child {
  if (!p) return null;
  const [text, href] =
    p.kind === "duel"
      ? ["Дуелът ти продължава", "/duel/live"]
      : p.kind === "room"
        ? ["Играта в стаята продължава", `/r/${p.code}`]
        : p.starts && p.starts <= Date.now()
          ? ["Роял чака още играчи", "/royal"]
          : p.starts
            ? [`Роял започва в ${clock(p.starts)}`, "/royal"]
            : ["Роял продължава", "/royal"];
  return h("p", { class: "streak-notice playing-notice", role: "status" }, text, h("a", { href }, "Върни се"));
}

/** The streak notices told on this page: the server keeps them as told (play.TellStreak), and each is said once. */
const toldHere = new Set<string>();

/** Keeps a streak notice as told, on the server, so that no other device (or private window) tells it again; a broken
 * streak on offer to be won back (`repair`) counts as offered then, once. */
function tellStreak(key: string, repair = false): boolean {
  if (toldHere.has(key)) return false;
  toldHere.add(key);
  api("POST", "/api/me/streak-told", { key, repair }).catch(() => toldHere.delete(key));
  return true;
}

/** What came of the days just missed — a reserve day kept the streak, or none was left and it ended — or, back after
 * days away, a welcome with the longest streak the player has had: said once, above the day (the server sends it
 * until it's told). */
function streakNotice(t: Today): Child {
  const key = t.kept ? `kept:${t.kept}` : t.ended ? `ended:${t.ended.on}` : t.back ? `back:${t.back.last}` : "";
  if (!key || !tellStreak(key)) return null;
  const begins = t.run?.done ? "Днес започна нова" : "Днес започва нова";
  const best = t.back?.best ?? 0;
  const text = t.kept
    ? `${onDay(t.kept).replace(/^./, (c) => c.toUpperCase())} резервен ден запази серията ти. Серия: ${t.streak === 1 ? "1 ден" : `${t.streak} дни`}.`
    : t.ended
      ? `Серията ти от ${t.ended.days} дни прекъсна. ${begins}.`
      : best > 1
        ? `Радваме се, че се върна. Най-дългата ти серия е ${best} дни. ${begins}.`
        : `Радваме се, че се върна. ${begins} серия.`;
  return h("p", { class: "streak-notice", role: "status" }, picture(t.kept ? "shield" : "flame", "reserve-pic"), text);
}

/** A streak just ended that can be won back today (play/repair.go): the day missed, played as its past issue
 * (screens/issues.ts), and today's ten, and what's left of them. The missed issue is the card's way: plain while the
 * day's ten wait (their card has the gold „Започни“), gold once they're played. Shown while it's on offer; told as the
 * streak's end (so that it isn't said later that it ended), and counted as offered, once, on the server. */
function repairCard(r: Today["repair"]): Child {
  if (!r) return null;
  tellStreak(`ended:${r.on}`, true);
  // The issues missed still to play, as the server says them, as its mails do (repairWords).
  const text = repairWords(r);
  const first = r.missed.find((m) => !m.done);
  return h(
    "section",
    { class: "card keep-card repair-card" },
    h("h2", null, `Серията ти от ${r.days} дни прекъсна`),
    h("p", { class: "muted" }, text),
    first
      ? h(
          "a",
          { class: r.day ? "btn primary big" : "btn", href: `/issues/${first.issue}` },
          `Изиграй брой ${first.issue}`,
        )
      : null,
  );
}

/** The streak and (once XP is open: a first day has the streak only) the level, side by side: each a tap from Профил,
 * where there's more of both. The reserve days sit on the flame's corner, each a tap from what they're for, so the
 * streak's words keep the chip's width (half a phone's, or the side column's on a wide screen). While the day's ten
 * wait, the streak is at stake: its flame unlit, its number still there, until the day played lights it (grow). */
function status(t: Today): HTMLElement | null {
  // A streak broken that can still be won back is at stake, not gone: its days, unlit, today's with them once the day
  // is played (what winning it back makes of it). A plain „0 дни поред“ reads as a scold: without a streak (nor a
  // reserve day) there's no chip, and the level takes the row, until the day played starts one.
  const repair = t.repair ? t.repair.days + (t.repair.day ? 1 : 0) : 0;
  const days = repair || t.streak;
  const lv = t.open?.xp ? t.level : undefined;
  if (!days && !lv) return null;
  const share = shareOf(lv);
  return h(
    "div",
    { class: "status-row" },
    days || t.reserve
      ? h(
          "div",
          { class: "streak-wrap" },
          days
            ? h(
                "a",
                {
                  class: `status-item streak-chip${repair ? " unlit repair" : t.run?.done ? "" : " unlit"}`,
                  href: "/me",
                },
                h("span", { class: "status-icon" }, picture("flame", "flame status-flame")),
                h(
                  "span",
                  { class: "status-text" },
                  h("b", { class: "status-n" }, String(days)),
                  h("span", { class: "status-label" }, repair ? "дни за връщане" : streakLabel(days)),
                ),
              )
            : null,
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
        )
      : null,
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

/** The streak's words beside its number. */
const streakLabel = (n: number) => (n === 1 ? "ден поред" : "дни поред");

/** How far into its level a player is, in percent. */
const shareOf = (lv?: Today["level"]) =>
  lv && lv.to > lv.from ? Math.round((100 * (lv.xp - lv.from)) / (lv.to - lv.from)) : 0;

/** The streak and the level just grown by the day played (`was` before it, `now` after), moved there in their chips
 * once the result has landed (`after`): the streak's number rolls on, the level's bar fills a moment later. Resolves
 * once both are over, for what's big to come after them (news.ts), never over them: a round streak's sheet opens
 * right after its number has rolled, so the chip never tells it first. Without the game's feel loaded, or with less
 * motion, they are simply as they are. */
async function grow(row: HTMLElement, was: Today, now: Today, after: Promise<void>): Promise<void> {
  const kit = feelKit();
  if (!kit) return;
  const moving: Promise<void>[] = [];
  const streak = row.querySelector<HTMLElement>(".streak-chip");
  // A streak half won back keeps its days at stake on the chip (status): nothing rolls on until it's won back.
  if (streak && now.streak === was.streak + 1 && !now.repair) {
    // The flame stays as it was before the day (unlit, or cold without a streak) until its number rolls on: then it
    // lights, swelling once. A round number rolls on quietly: its sound is the sheet's, a moment later.
    const off = was.streak ? "unlit" : "cold";
    streak.classList.add(off);
    after.then(() => streak.classList.remove(off));
    const round = streakMarks.includes(now.streak);
    moving.push(kit.streak(streak, now.streak, streakLabel, after, round ? { ...hands(), play: () => {} } : hands()));
  }
  const chip = row.querySelector<HTMLElement>(".level-chip");
  if (chip && was.level && now.level && now.open?.xp)
    moving.push(
      kit.level(
        chip,
        { level: was.level.level, share: shareOf(was.level), left: `още ${was.level.to - was.level.xp} XP` },
        { level: now.level.level, share: shareOf(now.level), left: `още ${now.level.to - now.level.xp} XP` },
        after.then(() => wait(200)),
        hands(),
      ),
    );
  await Promise.all(moving);
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

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
          ? `Следва въпрос ${at + 1} от 10. Довърши играта до полунощ.`
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
            ? `Около три минути · ${players} ${players === 1 ? "човек е играл" : "души са играли"} днес`
            : "Около три минути",
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
          h("a", { href: "/friends" }, "Покани приятел и сравнявайте резултатите си всеки ден."),
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
 * Bulgaria), what they make of the streak (`streak`: with today's; or, half won back, `repair`, what it will be if it's
 * won back today), a guest's ask to keep the game (`stake`: what it risks till then), and, where it isn't on yet, the
 * reminder's ask, which by mail asks for the email the keeping would. */
function tomorrowCard(
  day: string,
  streak: () => number,
  stake: () => string | null,
  repair: () => Today["repair"],
): Child {
  const left = signal(untilMidnight());
  const t = setInterval(() => left.set(untilMidnight()), 30_000);
  onCleanup(() => clearInterval(t));
  const ask = remindAsk(day, stake);
  return h(
    "section",
    { class: "card keep-card tomorrow" },
    h("h2", { class: "card-title" }, "Утре — нови десет"),
    h("p", { class: "muted" }, () => {
      const r = repair();
      if (r?.day && r.missed.some((m) => !m.done))
        return `След ${left()} Ако върнеш серията днес, утре тя става ${r.days + 2}.`;
      const n = streak();
      return `След ${left()}${n > 0 ? ` Изиграй ги и серията ти става ${n + 1}.` : ""}`;
    }),
    // The ask by mail asks a guest for the email itself: the line to keep the game steps aside for it.
    keepLine(stake, ask.mailing),
    ask.view,
  );
}

function untilMidnight(): string {
  const now = new Date();
  const sofia = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Sofia" }));
  const minutes = 24 * 60 - (sofia.getHours() * 60 + sofia.getMinutes());
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${minutes} мин.`;
  return minutes % 60 ? `${hours} ч. и ${minutes % 60} мин.` : `${hours} ч.`;
}

/** Where the reminder's asks are kept, on this device (notifications are a device's): lib/keep.ts, RemindAsks. */
const remindKey = "almanac.remind-ask";

/** The day played, in its card for tomorrow: shall we remind the player? By notification where one can come and isn't
 * on yet. Where none can (an iPhone in a browser tab, a browser without them, or one told to refuse them, there and
 * then too), by mail (keep.ts, mailAsk: a guest's email, proved by its code, keeps the game as well), unless it's on
 * already; never in an app's own browser, where the way out to the phone's leads (keepLine). At most three times,
 * and never twice in a day. `mailing`: the ask by mail is asking a guest for an email, or was told „Не сега“ today
 * (one „Не сега“ is enough for the email asked for both ways). */
function remindAsk(day: string, stake: () => string | null): { view: Child; mailing: () => boolean } {
  let asked = remindAsks(null);
  try {
    asked = remindAsks(localStorage.getItem(remindKey));
  } catch {
    // no storage here: ask
  }
  const save = (next: RemindAsks) => {
    asked = next;
    try {
      localStorage.setItem(remindKey, JSON.stringify(next));
    } catch {
      // not kept: asked (and counted) again next time
    }
  };
  const refused = () => !inApp && typeof Notification !== "undefined" && Notification.permission === "denied";
  const by = signal<"push" | "mail" | null>(pushable() && !refused() ? "push" : app ? null : "mail");
  const state = signal<"ask" | "on" | "gone">("gone");
  const mailNo = signal(asked.mailNo === day);
  const mailing = () => by() === "mail" && (state() === "ask" || mailNo()) && !user()?.email;
  if (asked.n >= 3 || asked.day === day || !by.peek()) return { view: null, mailing };
  // Each way of asking counted once a day on a device (play/measure.go), however often Начало is drawn.
  const shown = () => {
    const how = by.peek() ?? "mail";
    const next = remindShown(asked, how, day);
    if (!next) return;
    tally(how === "push" ? "pushask:shown" : "mailask:shown");
    save(next);
  };
  const ask = () => {
    state.set("ask");
    shown();
  };
  if (by.peek() === "push")
    pushOn().then(
      (on) => (on ? null : ask()),
      () => {},
    );
  else if (user.peek()?.email)
    api<{ day: boolean; can: boolean }>("GET", "/api/mail/prefs").then(
      (p) => (p.can && !p.day ? ask() : null),
      () => {},
    );
  else ask();
  const error = signal("");
  const yes = async () => {
    error.set("");
    try {
      const why = await turnOn();
      if (!why) {
        save(remindAnswered(asked, "push", day, true));
        state.set("on");
        tally("pushask:yes");
      } else if (refused() && !app) {
        // Told no just now: the mail, then, an ask of its own.
        error.set(why);
        by.set("mail");
        shown();
      } else error.set(why);
    } catch (err) {
      reportProblem(`reminder ask: ${(err as Error).name}: ${(err as Error).message}`);
      error.set("Не успяхме. Опитай пак.");
    }
  };
  const no = () => {
    const how = by.peek() ?? "mail";
    save(remindAnswered(asked, how, day, false));
    mailNo.set(how === "mail");
    state.set("gone");
    tally(how === "push" ? "pushask:no" : "mailask:no");
  };
  const view = () => {
    if (state() === "gone") return null;
    if (state() === "on")
      return h(
        "p",
        { class: "muted", role: "status" },
        "Готово. Ще ти напомним около часа, в който играеш, ако въпросите още те чакат.",
      );
    if (by() === "mail")
      return [
        () => error() && h("p", { class: "muted" }, error()),
        mailAsk({
          stake,
          no,
          yes: () => {
            save(remindAnswered(asked, "mail", day, true));
            tally("mailask:yes");
          },
        }),
      ];
    return [
      h(
        "p",
        { class: "muted" },
        "Да ти напомним, ако въпросите още те чакат? Веднъж на ден, около часа, в който играеш.",
      ),
      h(
        "div",
        { class: "remind-actions" },
        h("button", { class: "btn", type: "button", onclick: yes }, "Напомняй ми"),
        h("button", { class: "link tap", type: "button", onclick: no }, "Не сега"),
      ),
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
    ];
  };
  return { view, mailing };
}

/** Начало's way in, while the year's look back is fresh. */
export function yearCard(): Child {
  const { year, fresh } = yearNow();
  if (!year || !fresh || !user.peek()) return null;
  return h(
    "a",
    { class: "card year-card", href: `/year/${year}` },
    h("p", { class: "kicker" }, "Годината ти в играта"),
    h("strong", null, `Твоята ${year}`),
    h("span", { class: "muted" }, "Дни, отговори, научени факти и още. Виж ги."),
  );
}
