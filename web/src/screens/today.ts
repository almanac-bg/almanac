// Днес, the first of the three places: the day's issue. Its dateline („Брой 9“ · „Петък, 20 ноември“), the date set
// large, „Десет въпроса за днес.“ and „Започни“ (left half-way, where the player stopped and „Продължи“; come by a
// shared day's link, the score shared over the same ten). A new visitor has the cover alone; a player has beside it
// the streak and this week, the friends' day, and the way to their book. Once the day is played, the issue is its
// result (as it lands, and on every later visit): the score and its shape, how it went among everyone, sharing it
// (game/share.ts, in a sheet with its card and its text), what its right answers wrote in the book (its ink, by
// chapter, and a rank risen: game/news.ts), tomorrow (when the next issue comes, the streak it makes, the reminder's ask),
// and the day's board, among friends and of all България (dayBoard). A wrong game is
// never celebrated. A chapter is played from its page in the Алманах, duels from Приятели (a friend's duel waiting
// is its dot, a friend's yes its line). Once, under the streak: what came of the days just missed. Once, over the day:
// what came of a step just taken (a profile signed in to, a game brought here). In an app's own browser the result's action
// is the way out to the phone's browser with the game (keep.ts, exitWay), and the cover has a line for a game kept
// there; a game brought here by it (its token in the address's fragment: takeHand) lands on the result, whose action
// is then the ask to keep it and be reminded.

import { picture } from "../art/picture.ts";
import type { FriendDay } from "../game/knew.ts";
import { news } from "../game/news.ts";
import { closeLine, count, percent, withOwn } from "../game/numbers.ts";
import { answerWords } from "../game/questions.ts";
import { land, opensReview, reviewSheet } from "../game/results.ts";
import { getReady, playRun, shownHere, starting } from "../game/run.ts";
import { cardFile, cardPath, type SharedDay, shareCard, shareDay, shareText } from "../game/share.ts";
import type { Board, Mark, Reviewed, Score, State } from "../game/types.ts";
import { api, errorText, serverNow } from "../lib/api.ts";
import { boot } from "../lib/boot.ts";
import { dayInBulgaria, hourInBulgaria } from "../lib/day.ts";
import { type Child, h, onCleanup, type Signal, signal, slot } from "../lib/dom.ts";
import { handToken } from "../lib/embedded.ts";
import { reportProblem } from "../lib/errors.ts";
import { type RemindAsks, remindAnswered, remindAsks } from "../lib/keep.ts";
import { ordinal } from "../lib/ordinal.ts";
import { pushable, pushOn, turnOn } from "../lib/push.ts";
import { go, goBack, hold, release, title } from "../lib/router.ts";
import { dateWords, issueOf, onDay, stakeHour, weekday } from "../lib/words.ts";
import { cover, notice, player, playing, user } from "../state.ts";
import {
  chapterName,
  failure,
  formatNumber,
  glyph,
  leaf,
  scoreRow,
  segmented,
  stakeLine,
  textWords,
  tiles,
} from "../ui.ts";
import { app, coverExit, exitWay, handedIn, haveProfile, keepLine, keepStake, mailAsk, takeHand } from "./keep.ts";
import { loadStats, type Stats } from "./stats.ts";

export interface Today {
  day: string;
  /** The day's issue: its number from the first day of the day's ten (play/issue.go), the same for everyone. */
  issue?: number;
  /** The issue's chapters, in the order its ten are asked (play.IssueChapters): „В броя“. */
  chapters?: string[] | null;
  /** On a national day, its name (bank.NationalName: „Освобождението“): the cover says it under the date, and the
   * share after the issue. */
  national?: string;
  streak: number;
  /** Whether this week would still forgive a day missed (play/runs.go: two a week). */
  spare?: boolean;
  /** A day just missed that the week forgave (the last 3 days). */
  forgiven?: string;
  /** A streak that just ended (the last 3 days): the day missed that ended it. How many days it had is never said. */
  ended?: { on: string };
  /** Whether today is the player's first day (no game finished before it): the same all day, whatever they play. */
  firstDay?: boolean;
  run: State | null;
  board: Board;
  /** The day among the player and their friends, best first: once a friend has played it (null before). */
  friends?: Score[] | null;
  /** While no friend has played: whether the player has any friends at all. */
  befriended?: boolean;
  /** A game that ended without its result on screen (the day's last question let run out, a game left at its end):
   * its news, told here once (play/told.go). */
  untold?: number;
  /** Back after days away, the streak ended since (play.BackFrom): the last day played (no streak's number), said
   * once. */
  back?: { last: string };
  /** Yesterday's issue left half-way before midnight, while it can still be finished (play.Unfinished, DayGrace): its
   * day, issue, chapters and run, and until when (ms). Днес offers it first. */
  yesterday?: { day: string; issue: number; national?: string; chapters: string[] | null; run: State; until: number };
  /** Днес drawn for yesterday's issue (lateView): until when it can be finished, and the way on to today's. */
  late?: { until: number; today: () => void };
}

/** The day as Днес's page came with it (server/pages.go): its first draw, without asking; every later one asks. */
let inPage = boot.day as Today | undefined;

/** A day shared (server/share.go): its day, its issue, and its shape (play.Share: each of the ten, '1' right, '2'
 * близо, '0' wrong, '3' one that counts for nobody). */
interface Shared {
  day: string;
  issue: number;
  shape: string;
}

/** The day shared by the link the page was opened at, until Днес has taken it (sharedDay). */
let sharedIn = (boot.shared as Shared | undefined) ?? null;

/** A shared day's link (/d/<issue>-<code>), opened: Днес, which says the day shared once (today). The address
 * becomes Днес's, so that a reload, or the address copied from the bar, is the day's and not the share's. */
export function sharedDay(): Child {
  go("/", true);
  return null;
}

/** Each day played's questions gone over (its review), asked for once: the tenth's line and the dialog „Прегледай
 * въпросите“ opens all read the one answer. */
const reviews = new Map<number, Promise<Reviewed[]>>();
const reviewOf = (run: number): Promise<Reviewed[]> => {
  let r = reviews.get(run);
  if (!r) {
    r = api<{ questions: Reviewed[] }>("GET", `/api/runs/${run}/review`).then((x) => x.questions);
    reviews.set(run, r);
    r.catch(() => reviews.delete(run));
  }
  return r;
};

/** How many times Днес asks the day again after yesterday's issue's time is over and the day still offers it. */
const lateAsks = 4;

export function today() {
  title();
  // Come by a shared day's link: while it's still that day, its score and shape over the same ten, „Колко ще познаеш
  // ти?“; once it's over, a line that it is, over today's.
  const shared = sharedIn;
  sharedIn = null;
  // A profile just deleted, or a game just brought here, is said once, over the day.
  let bye = notice.peek();
  notice.set("");
  // The game's mails link here with ?from=mail (server/streakmail.go, daymail.go): their reader has a profile.
  const fromMail = new URLSearchParams(location.search).get("from") === "mail";
  if (fromMail) history.replaceState(history.state, "", "/");
  // A game brought from an app's own browser: its token in the address's fragment (keep.ts, exitWay), taken out of
  // the address at once and taken here (takeHand), not in an app's browser (the one it came from, reloaded).
  const hand = handToken(location.hash);
  if (hand) history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  // When yesterday's issue, offered first (lateView), can no longer be finished.
  let lateEnds: ReturnType<typeof setTimeout> | undefined;
  // How many times Днес has asked the day again since yesterday's time was over, and still had it (a question shown
  // before then still in its time): each a while apart, and a few at most.
  let lateAsked = 0;
  // The screen put away: an answer still on its way draws nothing, and sets no timer again.
  let gone = false;
  onCleanup(() => {
    gone = true;
    clearTimeout(lateEnds);
  });
  const load = async () => {
    try {
      const t = inPage ?? (await api<Today>("GET", "/api/day"));
      inPage = undefined;
      if (gone) return;
      day = t.day;
      // Yesterday's issue left half-way just before midnight, while the game lets it be finished: offered first.
      const view = lateView(t) ?? t;
      const run = view.run;
      // A question this tab was showing has its time running (a reload): straight back into it. Otherwise (another
      // device, or tab) the day left half-way waits on Днес for „Продължи“: no question's time starts without a tap.
      if (run && !run.done && run.question && shownHere(run.id))
        screen.show(() => playRun(run, (s) => home(view, s, true)));
      else screen.show(() => home(view, view.run, false));
    } catch (err) {
      if (!gone) screen.show(() => failure(err, load, null));
    }
  };
  /** Днес for yesterday's issue (`t.yesterday`): its day, issue, chapters and run; nothing of today's (its board, its
   * friends); and, once finished, the way on to today's. */
  const lateView = (t: Today): Today | null => {
    clearTimeout(lateEnds);
    const y = t.yesterday;
    if (!y) return null;
    // On to today's: the day asked for again (its streak, its board and friends as they are now, after yesterday's).
    const today = () => {
      scrollTo(0, 0);
      load();
    };
    // Its time over (DayGrace), Днес is today's: unless a question of it is being played (it ends by its own clock) or
    // counted down to, when the next drawing of Днес asks the day again anyway. Asked again with its time over already
    // (a question shown before it ended is still in its time), the day is asked again 15 seconds on, a few times.
    const left = y.until - serverNow();
    lateAsked = left > 0 ? 0 : lateAsked + 1;
    if (lateAsked <= lateAsks && !gone)
      lateEnds = setTimeout(
        () => {
          if (!playing.peek() && !counting) load();
        },
        left > 0 ? left + 1000 : 15_000,
      );
    return {
      ...t,
      day: y.day,
      issue: y.issue,
      national: y.national,
      chapters: y.chapters,
      run: y.run,
      board: { day: y.day, players: 0, of: y.run.total - (y.run.void ?? 0), top: [] },
      friends: null,
      yesterday: undefined,
      late: { until: y.until, today },
    };
  };
  // The day's ten (or the rest of them) start after the count every game has, which „Отказ“ backs out of: nothing
  // is sent before it runs out or „Започни сега“, so a tap by mistake costs nothing. What went wrong starting shows
  // on the issue, back on Днес. They're played over Днес in an entry of their own (router.ts, hold): back,
  // mid-game, asks first, then comes to Днес, not out of the game.
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
        "Днешният брой",
        async () => {
          screen.show(starting);
          try {
            await player();
            // Yesterday's goes on where it stopped; today's is the one the player has, or a new one.
            const s =
              t.late && left
                ? await api<State>("GET", `/api/runs/${left.id}`)
                : await api<State>("POST", "/api/day", {});
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
  // A new day while the screen stays open (a phone left on Днес overnight): the new day's ten, not yesterday's
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
  if (hand && !app)
    screen.show(() =>
      takeHand(hand, () => {
        inPage = undefined; // the page's day was for the browser as it was
        load();
      }),
    );
  else load();
  return h("div", null, screen);

  /** The screen itself: the issue, or (`run` done) its result; `just`: played this moment, so it lands and what it
   * brought is told, once. */
  function home(t: Today, run: State | null, just: boolean): Child {
    // A new visitor (no game begun yet) has the issue alone: the cover (the frame's places step aside).
    cover.set(!user.peek());
    onCleanup(() => cover.set(false));
    // Or a profile just signed in to here (haveProfile): what came of it; or a shared day that's over.
    const said =
      bye ||
      notice.peek() ||
      (shared && shared.day !== t.day && !run?.done ? `Брой ${shared.issue} вече мина. Ето днешния.` : "");
    bye = "";
    notice.set("");
    // Over the day, only what came of the player's own step; others' news is Приятели's (its dot, its lines).
    const notices = [
      said ? h("p", { class: "notice", role: "status" }, said) : null,
      // Come from the streak's mail to a browser signed out: the way in comes first, open.
      fromMail && !user.peek()?.email ? haveProfile(load) : null,
    ];
    // What came of the days just missed, once: under the streak, before the day is played. The result says nothing of
    // the streak, so there it's only kept as told. On an evening the streak ends at midnight without the day, the
    // streak's line says that, and what came of the days missed waits, untold, for another visit.
    const streakSaid = !run?.done && t.streak >= 3 && endsTonight(t) ? null : streakNotice(t);
    if (run?.done) return result(t, run, just, notices, load);
    // The player's numbers (Профил's): the streak's week, the facts in the book.
    const stats = signal<Stats | null>(null);
    if (user.peek()) loadStats().then(stats.set, () => {});
    const first = !user.peek();
    const marks = run?.trail ?? [];
    // Днес's budget (DESIGN.md): the issue, its action, the streak; on a big screen the issue's contents under them.
    return h(
      "section",
      { class: first ? "screen today first spread" : "screen today spread" },
      h("div", { class: "notices" }, notices),
      issue(t, marks, shared?.day === t.day ? shared : null, first),
      h(
        "div",
        { class: "today-side page-2" },
        issueGo(start(t), marks.length, failed, first),
        first ? null : streakSection(t, stats, false, streakSaid),
        first || t.streak >= 3 || !streakSaid
          ? null
          : h("p", { class: "streak-notice", role: "status" }, streakSaid.long),
        first ? null : untold(t),
        // A new visitor's cover says once what the ten are (issueGo): no list of them again beside it.
        first ? null : contents(t),
      ),
    );
  }
}

/** The day's ten, not played yet, as the day's issue: a stack of ten sheets in the colours of its ten chapters, the top
 * one the first question's, its corner turned on the second's. On it the issue's number and weekday, the date set
 * large, „Десет въпроса за днес“, the ten chapters' glyphs, and how long it takes; left half-way (`marks`), where the
 * player stopped and its tiles so far. Come by a shared day's link (`shared`), whoever shared it and how they did, and
 * the question is the player's. Before play there's no shape: it would measure nothing yet. */
function issue(t: Today, marks: Mark[], shared: Shared | null, first: boolean): Child {
  const players = t.board.players;
  const at = marks.length;
  const lead = shared && !at ? shared : null;
  const order = t.chapters?.length ? t.chapters : [];
  const [, , date = 1] = t.day.split("-").map(Number);
  const top = order[0] ?? "general";
  const sharedMarks: Mark[] = lead
    ? [...lead.shape].map((c) => ({ right: c === "1", close: c === "2", void: c === "3" }))
    : [];
  return h(
    "div",
    { class: "issue day page-1" },
    // The sheets under the top one, each its chapter's colour, a little narrower and lower than the one over it.
    h(
      "div",
      { class: "issue-stack", "aria-hidden": "true" },
      order
        .slice(1)
        .map((id, i) => h("span", { class: `stack-leaf ch-${id}`, style: { "--i": String(order.length - 1 - i) } })),
    ),
    leaf(
      top,
      [
        h(
          "p",
          { class: "issue-top" },
          h("span", { class: "issue-n" }, `Брой ${t.issue ?? issueOf(t.day)}`),
          h("span", { class: "issue-weekday" }, weekday(t.day).toLowerCase()),
        ),
        h(
          "p",
          { class: "issue-date" },
          h("time", { datetime: t.day }, h("b", { class: "issue-day" }, String(date))),
          " ",
          h("span", { class: "issue-month" }, dateWords(t.day).split(" ")[1] ?? ""),
          // A national day's name under its date („3 март“, „Освобождението“), quietly: the questions dated to it
          // come first, one a chapter still.
          t.national ? [" ", h("span", { class: "issue-national" }, t.national)] : null,
        ),
        h(
          "div",
          { class: "issue-body" },
          h(
            "h1",
            { class: "issue-title" },
            t.late
              ? "Десет въпроса от вчера"
              : lead
                ? `Някой позна ${sharedMarks.filter((m) => m.right).length}\u00a0от\u00a0${sharedMarks.filter((m) => !m.void).length}. А ти?`
                : "Десет въпроса за днес",
          ),
          at
            ? [h("p", { class: "issue-deck" }, `Следва въпрос ${at + 1}\u00a0от\u00a010.`), tiles(marks, order)]
            : lead
              ? h("div", { class: "shared-score" }, tiles(sharedMarks, order, sharedMarks.length))
              : order.length
                ? h(
                    "ol",
                    { class: "issue-toc", "aria-label": "В броя" },
                    order.map((id, i) => h("li", { "aria-label": `${i + 1}. ${chapterName(id)}` }, glyph(id, 36))),
                  )
                : null,
          h(
            "p",
            { class: t.late || at || players >= crowdFrom ? "issue-meta" : "issue-meta issue-time" },
            // Yesterday's, begun or not: until when it can be finished.
            t.late
              ? `Вчерашният брой. Довърши го до ${clockAt(t.late.until)}.`
              : at
                ? "Довърши броя до полунощ."
                : // Who has played today, once enough have for it to say something.
                  players >= crowdFrom
                  ? [
                      // With large text, how long it takes gives way to the cover (app.css, .issue-time).
                      h("span", { class: "issue-time" }, "Около три минути ·\u00a0"),
                      `Днес играха ${formatNumber(players)}\u00a0души`,
                    ]
                  : "Около три минути",
          ),
        ),
      ],
      first ? "issue-leaf first" : "issue-leaf",
      { next: order[1] ?? "" },
    ),
  );
}

/** From how many players today's count is said on the cover: below it, a count says little but that it's early. */
const crowdFrom = 100;

/** The issue's action beside it: „Започни“ (or, left half-way, „Продължи“), what went wrong starting it (`error`),
 * and for a new visitor what the ten are, first. */
function issueGo(start: () => void, at: number, error: string, first: boolean): Child {
  return [
    h("button", { class: "btn primary issue-go", onclick: start }, at ? "Продължи" : "Започни"),
    first && !at ? coverExit() : null,
    error ? h("p", { class: "bad", role: "alert" }, error) : null,
    // A new visitor: what the ten are, under the action (which stays high on the screen).
    first && !at
      ? h(
          "div",
          { class: "issue-words" },
          h("h2", null, "Едни и същи за цяла България."),
          h("p", { class: "deck" }, "По един въпрос от всяка от десетте теми, от лесен към труден. Без регистрация."),
        )
      : null,
  ];
}

/** The issue's contents on a big screen („В броя“): its ten chapters in their order, each with its glyph, the tenth
 * named the hard number. */
function contents(t: Today): Child {
  const list = t.chapters ?? [];
  if (list.length < 2) return null;
  return h(
    "section",
    { class: "sect contents-issue" },
    h("div", { class: "sect-head" }, h("h2", null, "В броя"), h("span", { class: "sect-note" }, "от лесен към труден")),
    h(
      "ol",
      { class: "rows" },
      list.map((id, i) =>
        h(
          "li",
          { class: "contents-row" },
          h("span", { class: "contents-n" }, String(i + 1)),
          glyph(id, 30),
          h("span", { class: "contents-name" }, chapterName(id)),
          i === list.length - 1 ? h("span", { class: "contents-hard" }, "най-трудният") : null,
        ),
      ),
    ),
  );
}

/** Whether the streak ends at midnight without today's issue, and it's the evening (stakeWords): no day left to forgive. */
const endsTonight = (t: Today) => t.streak >= 1 && !(t.spare ?? true) && hourInBulgaria() >= stakeHour;

/** The streak: its number and „дни без прекъсване“, and its one line under it: what came of the days just missed (`said`,
 * once), or a day the week forgave; while the day's ten wait (`done` false), it is at stake, unlit, and from the
 * evening, if it ends at midnight, that's said, before anything else. Nothing below three days (direction: the streak
 * shows from 3). */
function streakSection(t: Today, stats: () => Stats | null, done: boolean, said?: StreakSaid | null): Child {
  return () => {
    const days = t.streak;
    if (days < 3) return null;
    const s = stats();
    const forgiven = !done && endsTonight(t) ? 0 : (s?.forgiven?.filter(Boolean).length ?? 0);
    return h(
      "a",
      {
        class: done ? "streak-chip today-streak" : "streak-chip today-streak unlit",
        href: "/me",
        "aria-label": `Серия: ${days} дни`,
      },
      picture("flame", "streak-flame tone-flame"),
      h("b", { class: "status-n" }, String(days)),
      h(
        "span",
        { class: "status-text" },
        h("span", { class: "status-label" }, days === 1 ? "ден без прекъсване" : "дни без прекъсване"),
        said
          ? h("span", { class: "streak-note", role: "status" }, said.short)
          : forgiven
            ? h(
                "span",
                { class: "streak-note" },
                forgiven === 1
                  ? "Тази седмица един пропуснат ден е простен."
                  : forgiven === 2
                    ? "Тази седмица два пропуснати дни са простени."
                    : `Тази седмица ${forgiven} пропуснати дни са простени.`,
              )
            : done
              ? null
              : stakeLine(days, t.spare ?? true),
      ),
    );
  };
}

/** How many a day's right answers are out of: all but those that count for nobody (Mark.void). */
const outOf = (s: State) => s.total - (s.void ?? 0);

/** The day played, as a page, in its budget's order (DESIGN.md, The result), the HTML's order too:
 *
 *   1. the score on its sheet, the tiles, how many knew the tenth, and how all of България did on average;
 *   2. what the day wrote in the book („Днес в Алманаха“: its ink, by chapter; a rank risen);
 *   3. the action: sharing it (on the first results, keeping the game and being reminded, or the way out of an app's
 *      browser, which come right under the score instead);
 *   4. tomorrow;
 *   5. the day's board, Приятели · България (dayBoard).
 *
 * Everything else (the questions and their facts) is in the questions' dialog (results.ts, reviewSheet), opened by
 * „Прегледай въпросите“, by a tap on the score's card, and by a tile, at its question. As it's
 * played (`just`), it lands (feel.ts) and what it brought is told; on a later visit it is as it is. A wrong game is
 * never celebrated; ten of ten is a big moment. */
function result(t: Today, run: State, just: boolean, notices: Child[], reload: () => void): Child {
  const fresh = signal<Today>(t);
  // The day as it stands with the game just played (its streak, its friends): until it's here, the streak with today's
  // isn't known, and the share (which says it) waits for it.
  const known = signal(!just || !!t.late);
  const now = just && !t.late ? api<Today>("GET", "/api/day") : null;
  now?.then(fresh.set, () => {}).finally(() => known.set(true));
  const of = outOf(run);
  const perfect = of > 0 && run.rights === of;
  // None right: the questions missed and their facts, open right under the score, the rest a tap away.
  const zero = of > 0 && run.rights === 0;
  const review = reviewOf(run.id);
  // None right: the questions missed, under the score, once they're here (none, while the review hasn't come: the
  // button „Прегледай въпросите“ stays, to ask for them again).
  const missedList = signal<Reviewed[] | null>(null);
  if (zero) review.then(missedList.set, () => {});
  // The day's board's tab, as the player chose it (none yet: dayBoard opens it).
  const among = signal<Among | null>(null);
  // The day's questions in their dialog, at one of them (`at`: a tile's); asked again if they failed (reviewOf keeps
  // only a review that came). With them, how the friends who finished the day did with each, asked each time it opens
  // (a friend may have played since); not asked of a player without friends.
  const openReview = (at?: number) =>
    reviewSheet({
      load: () => reviewOf(run.id),
      of: `Брой\u00a0${t.issue ?? issueOf(t.day)} · ${dateWords(t.day)} · ${run.rights} от ${of}`,
      at,
      friends:
        fresh.peek().befriended === false && !fresh.peek().friends?.length
          ? undefined
          : () => api<{ friends: FriendDay[] }>("GET", `/api/runs/${run.id}/friends`).then((r) => r.friends),
    });
  const order = t.chapters ?? [];
  // The streak with today's, the game's stake, and the reminder's ask. A guest in an app's own browser has the way out
  // for the action; a guest on the first day, or one whose game was just brought here, the ask to keep it and be
  // reminded (while it's there to ask), right under the score; everyone else, sharing the day, and the reminder's ask
  // under the result, in `.asks` (a guest's by mail keeps the game too), never a second action: at most three times,
  // once a day (remindAsk). None for yesterday's issue finished late: the way on to today's is in their place.
  const streak = () => (just && fresh() === t ? 0 : fresh().streak);
  const stake = keepStake(
    () => (streak() >= 2 ? 2 : 1),
    () => streak(),
  );
  const guest = !user.peek()?.email;
  const away = !!app && guest;
  // A first day: as the server says, or, for a visitor who had no game at all when Днес came, this one.
  const askFirst = !away && guest && (handedIn.peek() || t.firstDay !== false);
  const ask = away || t.late ? null : remindAsk(t.day, stake, reload, askFirst);
  const first = away || askFirst;
  // While the action is another (the ask, the way out), sharing stays a quiet link beside the tiles.
  const shareQuiet = () =>
    away || (askFirst && (ask?.deciding() || ask?.showing())) ? shareLink(run, t, streak, known) : null;
  // 1. The score, the cover's heavy numeral on the sheet of the issue's first chapter.
  const hero = leaf(
    order[0] ?? "general",
    [
      perfect ? h("div", { class: "perfect-head" }, perfectMark(), h("p", { class: "kicker" }, "Всички верни")) : null,
      h(
        "p",
        { class: "kicker score-kicker" },
        `Брой\u00a0${t.issue ?? issueOf(t.day)} ·\u00a0${dateWords(t.day).replace(" ", "\u00a0")}`,
      ),
      h(
        "h1",
        { class: "score" },
        h("b", { class: "score-n" }, String(run.rights)),
        h("span", { class: "score-of" }, `от ${of}`),
        closeLine(run.trail) ? h("span", { class: "score-close" }, closeLine(run.trail)) : null,
      ),
      tiles(run.trail, order, run.total, undefined, openReview),
      shareQuiet,
      tenthLine(review),
      () => {
        const avg = fresh().board.average;
        return avg ? h("p", { class: "score-bg" }, `България днес: средно ${averageWords(avg)}`) : null;
      },
    ],
    "result-score score-leaf",
  );
  opensReview(hero, () => openReview());
  if (just) land(hero, run.id, perfect, true);
  // A best rank risen, the result's one big moment: first, right under the score.
  const best = signal<Child>(null);
  const action = h(
    "div",
    { class: first ? "result-share result-first" : "result-share" },
    // The ask while it's being found out whether to ask (notifications on already?): nothing yet, not „Сподели“ swapped
    // for it a moment later.
    away
      ? exitWay(stake)
      : askFirst
        ? () => (ask?.deciding() ? null : ask?.showing() ? ask.view : shareButton(run, t, streak, known))
        : null,
    first ? null : shareButton(run, t, streak, known),
  );
  // The left page is the player's own day: the score, what it wrote in the book, the action, tomorrow; the right page
  // is everyone's, the day's board, with the room to itself. On a phone, one column in that order.
  const page = h(
    "section",
    { class: "screen result summary spread" },
    h("div", { class: "notices" }, notices),
    h(
      "div",
      { class: "result-main page-1" },
      hero,
      best,
      zero ? missed(missedList, () => openReview()) : null,
      // The first results' action, right under the score.
      first ? action : null,
      // 2. What the day wrote in the book. Asked on every visit: the ink is counted again; a rank risen is told once
      // (play.NewsOf).
      news(run.id, 0, undefined, best.set, "Днес в Алманаха"),
      // 3. The action, once the first results are past.
      first ? null : action,
      // 4. Yesterday's issue finished after midnight: on to today's. Otherwise the asks, if any.
      t.late ? onToToday(t, t.late.today) : asks(stake, first ? null : ask, reload),
    ),
    h(
      "div",
      { class: "result-side page-2" },
      // 5. The day's board (none for yesterday's issue finished late: Днес hasn't its board).
      t.late ? null : () => dayBoard(fresh(), run, among),
      // None right: the first questions are open under the score already, with the way to them all there (once they
      // came).
      () => (missedList()?.length ? null : reviewButton(() => openReview())),
    ),
  );
  return page;
}

/** „Прегледай въпросите“: the day's questions and their facts, a tap away in their dialog. */
const reviewButton = (open: () => void): Child =>
  h(
    "button",
    { class: "more", type: "button", "aria-haspopup": "dialog", onclick: open },
    "Прегледай въпросите",
    h("span", { class: "i i-right", "aria-hidden": "true" }),
  );

/** How many of the questions missed a result with none right shows at once. */
const missedShown = 4;

/** None right: the first questions, each its chapter's tile, the question, the right answer and the fact, right under
 * the score; „Прегледай въпросите“ under them opens them all in their dialog (`open`). Never a word of praise: only
 * what the questions were. */
function missed(all: () => Reviewed[] | null, open: () => void): Child {
  return () => {
    const list = all();
    if (!list?.length) return null;
    const shown = list.slice(0, missedShown);
    return h(
      "section",
      { class: "sect missed-day" },
      h(
        "div",
        { class: "sect-head" },
        h("h2", null, "Въпросите"),
        list.length > shown.length ? h("span", { class: "sect-note" }, `1–${shown.length} от ${list.length}`) : null,
      ),
      h(
        "ol",
        { class: "missed" },
        shown.map((q) =>
          h(
            "li",
            { class: "miss" },
            h(
              "span",
              {
                class: `tile ${q.void ? "void" : "wrong"} ch-${q.chapter}`,
                role: "img",
                "aria-label": chapterName(q.chapter),
              },
              h("span", { class: "tile-pic" }, picture(`chapter-${q.chapter}`)),
            ),
            h("p", { class: "miss-q" }, q.view.text),
            rightAnswer(q),
            q.reveal.fact ? h("p", { class: "miss-f" }, q.reveal.fact) : null,
          ),
        ),
      ),
      reviewButton(open),
    );
  };
}

/** A question's right answer, as a miss shows it: a word or a number; an order its items in their right order, a
 * match its pairs, a split each group with its items, a line each. */
function rightAnswer(q: Reviewed): Child {
  const { view: v, reveal: r } = q;
  const lines =
    v.type === "order"
      ? (r.order ?? []).map((item, i) => `${i + 1}. ${v.items[item] ?? ""}`)
      : v.type === "match"
        ? v.left.map((left, i) => `${left} — ${v.right[r.pairs?.[i] ?? -1] ?? ""}`)
        : v.type === "split"
          ? v.groups.map((g, k) => `${g}: ${v.items.filter((_, i) => (r.sides?.[i] ?? 0) === k).join(", ")}`)
          : null;
  if (lines)
    return h(
      "ul",
      { class: "miss-a miss-lines" },
      lines.map((l) => h("li", null, textWords(l))),
    );
  const answer = answerWords(v, r);
  return answer ? h("p", { class: "miss-a" }, textWords(answer)) : null;
}

/** The day's average right answers, always to one decimal, wherever it's said: „6,0“, „6,2“ (never „6“ on one result
 * and „6,1“ on another). */
const averageWords = (avg: number) => avg.toLocaleString("bg", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A question of the ten by its place, as the result's line names it („Десетият“). */
const lastWords = [
  "Първият",
  "Вторият",
  "Третият",
  "Четвъртият",
  "Петият",
  "Шестият",
  "Седмият",
  "Осмият",
  "Деветият",
  "Десетият",
];

/** How many knew the day's tenth, its hard number: „На десетия въпрос вярно отговарят 14 %“ (the player among them, as
 * the issue said it); nothing before there's a crowd (the tenth is always the hardest: saying so says nothing). */
function tenthLine(review: Promise<Reviewed[]>): Child {
  const said = signal("");
  review.then(
    (all) => {
      // The last that counts: the tenth, unless it counts for nobody (Mark.void), then the one before it.
      const last = all.filter((q) => !q.void).at(-1);
      if (!last) return;
      const which = lastWords[last.n] ?? "Последният";
      const c = last.reveal.crowd;
      // The share as the issue said it when it was answered (crowdLine): the player among them.
      if (c?.answers)
        said.set(
          `На ${which.slice(0, -1).toLowerCase()} въпрос вярно отговарят ${percent(withOwn(c, -1, last.right).right)}`,
        );
    },
    () => {},
  );
  return () => (said() ? h("p", { class: "tenth" }, said()) : null);
}

/** Where the day's board looks: among the player and their friends, or at all of България. */
type Among = "friends" | "all";

/** The day's board, one card on the result (DESIGN.md, The result): „Класация“ and two tabs, Всички first, then
 * Приятели. It opens among friends all the same, or on all България for a player with none yet (`among` keeps the
 * tab chosen while the result is open). Nothing until the day as it stands with the game played is here: before,
 * the board doesn't name its players to the player, nor show anyone's squares (play.FriendsBoard). */
function dayBoard(t: Today, run: State, among: Signal<Among | null>): Child {
  if (!t.run?.done) return null;
  const opens: Among = t.friends?.length || t.befriended ? "friends" : "all";
  const now = () => among() ?? opens;
  return h(
    "section",
    { class: "sect day-board" },
    h("div", { class: "sect-head" }, h("h2", null, "Класация")),
    segmented<Among>(
      "Класация сред",
      [
        ["all", "Всички"],
        ["friends", "Приятели"],
      ],
      now,
      (v) => among.set(v),
    ),
    () => (now() === "all" ? everyone(t, run) : ofFriends(t)),
  );
}

/** The day among the player's friends: each who played, best first, the player among them. A row says what places
 * it: the right answers („8 от 10“; a tie between them broken as play/board.go says, never by time: those still equal
 * share a place, the server's); the player's own row washed, „ти“ after the name. No friend has played yet: the
 * player's own row all the same, and why it's alone (no friends at all: the way to Приятели to add some). */
function ofFriends(t: Today): Child {
  const rows = t.friends ?? [];
  if (!rows.length) {
    const mine = t.board.mine ?? t.board.top.find((s) => s.me);
    return [
      mine ? h("ol", { class: "rows ranks" }, scoreRow({ ...mine, me: true }, 1)) : null,
      t.befriended === false
        ? h(
            "p",
            { class: "board-empty" },
            "Още нямаш приятели. ",
            h("a", { href: "/friends" }, "Добави приятели"),
            " и сравнявайте резултатите си всеки ден.",
          )
        : h("p", { class: "board-empty" }, "Още никой от приятелите ти не е играл днес."),
    ];
  }
  return h(
    "ol",
    { class: "rows ranks" },
    rows.map((s, i) => scoreRow(s, s.place ?? i + 1)),
  );
}

/** The day among everyone who played it: how they spread (spreadChart), where the player stands, then the best twenty
 * and the player's own place under them if further down. Alone on the board, a place says nothing; with none right,
 * it would only rub the day in: how many played instead. */
function everyone(t: Today, run: State): Child {
  const b = t.board;
  const mine = b.mine && b.place && !b.top.some((s) => s.me) ? b.mine : null;
  return [
    spreadChart(b, run),
    b.players < 2
      ? null
      : b.place && b.mine?.rights
        ? h(
            "p",
            { class: "board-note" },
            `В България си на ${ordinal(b.place, "n")} място от ${formatNumber(b.players)}.`,
          )
        : h("p", { class: "board-note" }, `Днес играха ${formatNumber(b.players)} души.`),
    b.top.length
      ? h(
          "ol",
          { class: "rows ranks" },
          b.top.map((s, i) => scoreRow(s, s.place ?? i + 1)),
          mine && b.place ? scoreRow(mine, b.place, b.place > b.top.length + 1) : null,
        )
      : null,
  ];
}

/** How all of България did with the day: how many got each count of right answers, the player's own bar in ink with
 * „ти“ over it and the average dashed. From ten players (play.Board.Spread: people only). */
function spreadChart(b: Board, run: State): Child {
  const spread = b.spread;
  if (!spread?.length) return null;
  const most = Math.max(1, ...spread);
  const avg = b.average ?? 0;
  const mine = Math.min(run.rights, spread.length - 1);
  return h(
    "div",
    {
      class: "spread-chart",
      role: "img",
      "aria-label": `Колко играчи имат по колко верни отговора: най-много имат ${spread.indexOf(Math.max(...spread))}. Ти: ${run.rights}.`,
    },
    h(
      "div",
      { class: "spread-bars" },
      spread.map((n, i) =>
        h("i", { class: i === mine ? "me" : undefined, style: { height: `${Math.max(1, (100 * n) / most)}%` } }),
      ),
      avg
        ? h(
            "span",
            { class: "spread-avg", style: { left: `${((avg + 0.5) / spread.length) * 100}%` } },
            h("span", null, `средно ${averageWords(avg)}`),
          )
        : null,
    ),
    h(
      "div",
      { class: "spread-ticks", "aria-hidden": "true" },
      spread.map((_, i) => h("span", { class: i === mine ? "me" : undefined }, String(i))),
    ),
  );
}

/** „Сподели резултата“: the sheet with the day's card and its text (game/share.ts), „Сподели“ (the device's share
 * sheet, where there is one), „Копирай текста“ and the card on its own. Held until the streak with today's is
 * `known` (the text says it). */
/** Sharing as a quiet link beside the tiles, where the result's action is another (the first results): the same sheet
 * as „Сподели“. */
function shareLink(run: State, t: Today, streak: () => number, known: () => boolean): Child {
  return h(
    "button",
    {
      class: "link tap result-share-link",
      type: "button",
      disabled: () => !known(),
      onclick: () => shareSheet(run, t, streak()),
    },
    h("span", { class: "i i-share", "aria-hidden": "true" }),
    "Сподели резултата",
  );
}

function shareButton(run: State, t: Today, streak: () => number, known: () => boolean): Child {
  const open = () => shareSheet(run, t, streak());
  return h(
    "button",
    { class: "btn primary result-share-go", type: "button", disabled: () => !known(), onclick: open },
    h("span", { class: "i i-share", "aria-hidden": "true" }),
    "Сподели",
  );
}

/** The share sheet over the result (a <dialog>, from the foot on a phone, centred on a big screen): the card that goes
 * with it (the server's, as a link's preview shows it: game/share.ts, cardFile), the text, and the ways to send it. Esc, „Затвори“ or a tap beside it puts it
 * away. */
function shareSheet(run: State, t: Today, streak: number): void {
  const issue = t.issue ?? issueOf(t.day);
  const national = t.national ? `${dateWords(t.day)} · ${t.national}` : undefined;
  const day: SharedDay = { issue, rights: run.rights, of: outOf(run), streak, marks: run.trail, national };
  const text = signal("");
  const said = signal("");
  const card = signal<File | null>(null);
  const sheet = h("dialog", { class: "sheet share-sheet", "aria-labelledby": "share-title" }) as HTMLDialogElement;
  const close = () => {
    sheet.close();
    sheet.remove();
  };
  shareText(run.id, day).then(text.set, (err) => said.set(errorText(err)));
  // Fetched as the sheet opens, so a tap on „Сподели картинката“ shares at once; shown once it's here (from the
  // browser's cache), the tiles until then or without it.
  cardFile(issue, run.trail).then(card.set, () => {});
  const send = async () => {
    said.set("");
    try {
      const out = await shareDay(run.id, day);
      if (out === "copied") said.set("Копирано.");
      else if (typeof out === "object") said.set("Не успяхме да го копираме. Маркирай текста по-горе и го копирай.");
      else if (out === "shared") close();
    } catch (err) {
      said.set(errorText(err));
    }
  };
  // The card on its own, where the device's share sheet takes a picture: the text with its link goes by „Сподели“
  // (an app that takes both keeps only the picture: WhatsApp on an iPhone).
  const sendCard = async () => {
    said.set("");
    const file = card.peek();
    if (file && (await shareCard(file)) === "shared") close();
  };
  const canShareCard = () => {
    const file = card();
    return !!file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text.peek() || (await shareText(run.id, day)));
      said.set("Копирано.");
    } catch {
      said.set("Не успяхме да го копираме. Маркирай текста по-горе и го копирай.");
    }
  };
  const canShare = typeof navigator.share === "function";
  sheet.append(
    h(
      "div",
      { class: "sheet-panel" },
      h(
        "div",
        { class: "sheet-head" },
        h("h2", { id: "share-title" }, "Сподели резултата"),
        h("button", { class: "link", type: "button", onclick: close }, "Затвори"),
      ),
      h("div", { class: "share-card-box" }, () =>
        card()
          ? h("img", {
              class: "share-card",
              src: cardPath(issue, run.trail),
              alt: `АЛМАНАХ, Брой ${issue}, ${dateWords(t.day)}: как мина всеки от десетте въпроса`,
              width: 1200,
              height: 630,
            })
          : tiles(run.trail, t.chapters ?? []),
      ),
      h("pre", { class: "share-text" }, () => text() || "…"),
      h(
        "div",
        { class: "share-ways" },
        canShare ? h("button", { class: "btn primary", type: "button", onclick: send }, "Сподели") : null,
        h("button", { class: canShare ? "btn" : "btn primary", type: "button", onclick: copy }, "Копирай текста"),
        () =>
          canShareCard()
            ? h("button", { class: "btn share-card-go", type: "button", onclick: sendCard }, "Сподели картинката")
            : null,
      ),
      () => (said() ? h("p", { class: "share-said", role: "status" }, said()) : null),
      h("p", { class: "small share-note" }, "Отговорите не се виждат. Който отвори връзката днес, играе същия брой."),
    ),
  );
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) close();
  });
  sheet.addEventListener("close", () => sheet.remove());
  document.body.append(sheet);
  sheet.showModal();
}

/** Yesterday's issue finished after midnight (`t.late`): in the asks' place, today's issue, out already, and the way
 * to it. */
function onToToday(t: Today, today: () => void): Child {
  const next = new Date(`${t.day}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const day = next.toISOString().slice(0, 10);
  return h(
    "section",
    { class: "sect tomorrow" },
    h("div", { class: "sect-head" }, h("h2", null, "Днес")),
    h(
      "div",
      { class: "tomorrow-row" },
      h("b", { class: "tomorrow-n" }, day.slice(8).replace(/^0/, "")),
      h(
        "p",
        { class: "tomorrow-words" },
        h("b", null, `Брой ${issueOf(day)}, ${weekday(day).toLowerCase()},`),
        " вече излезе.",
      ),
    ),
    h("button", { class: "btn", type: "button", onclick: today }, "Към днешния брой"),
  );
}

/** Under the result, the asks that come with it: a guest's to keep the game (keep.ts: what it risks till then,
 * `stake`) and, where it isn't on yet, the reminder's (`ask`; null where the result's action is the ask, or the way
 * out of an app's browser): nothing else, and nothing at all when neither is asked (`.asks:empty`). */
function asks(
  stake: () => string | null,
  ask: { view: Child; mailing: () => boolean } | null,
  signedIn: () => void,
): Child {
  // The ask by mail asks a guest for the email itself: the line to keep the game steps aside for it.
  return ask ? h("section", { class: "sect asks" }, keepLine(stake, ask.mailing, signedIn), ask.view) : null;
}

/** The news of a game whose result was never on screen (`t.untold`; of `run` only, if given: the day's, under its
 * result; another's under „От последната ти игра“), told once: the next drawing of Днес has none. */
function untold(t: Today, run?: number): Child {
  const id = t.untold;
  if (!id || (run !== undefined && id !== run)) return null;
  t.untold = undefined;
  return news(id, 0, { title: run ? "" : "От последната ти игра" });
}

/** The streak notices told on this page: the server keeps them as told (play.TellStreak), and each is said once. */
const toldHere = new Set<string>();

/** Keeps a streak notice as told, on the server, so that no other device (or private window) tells it again. */
function tellStreak(key: string): boolean {
  if (toldHere.has(key)) return false;
  toldHere.add(key);
  api("POST", "/api/me/streak-told", { key }).catch(() => toldHere.delete(key));
  return true;
}

/** What came of the days just missed — the week forgave one, or it had forgiven all it does and the streak ended — or,
 * back after days away, a welcome with the longest streak the player has had: said once, over the day (the server
 * sends it until it's told). */
function streakNotice(t: Today): StreakSaid | null {
  const key = t.forgiven
    ? `forgiven:${t.forgiven}`
    : t.ended
      ? `ended:${t.ended.on}`
      : t.back
        ? `back:${t.back.last}`
        : "";
  if (!key || !tellStreak(key)) return null;
  const begins = t.run?.done ? "Днес започна нова серия" : "Днес започва нова серия";
  // An ended streak's number is never said (DECISIONS.md, „The direction“): only that a new one begins.
  if (t.forgiven) {
    const missed = `${onDay(t.forgiven).replace(/^./, (c) => c.toUpperCase())} пропусна броя, но серията остава.`;
    return {
      short: missed,
      long: `${missed} До два пропуснати дни на седмица ти се прощават. Серия: ${count(t.streak, "ден", "дни")}.`,
    };
  }
  const text = t.ended ? `Серията ти прекъсна. ${begins}.` : `Радваме се, че се върна. ${begins}.`;
  return { short: text, long: text };
}

/** A streak notice in its two lengths: in the streak's one line, and on its own where the streak doesn't show yet. */
interface StreakSaid {
  short: string;
  long: string;
}

/** The logo's rosette over ten of ten: four petals, the gold one last (feel.ts draws them in). */
function perfectMark(): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("class", "perfect-mark");
  svg.setAttribute("aria-hidden", "true");
  for (const turn of [45, 135, 225, -45]) {
    const group = document.createElementNS(ns, "g");
    group.setAttribute("transform", `rotate(${turn} 32 32)`);
    const petal = document.createElementNS(ns, "path");
    petal.setAttribute("d", "M32 30.2C24.5 24.7 21.5 14.7 26 9.9c3.2-3.4 8.8-3.4 12 0 4.5 4.8 1.5 14.8-6 20.3z");
    petal.setAttribute("class", turn < 0 ? "petal gold" : "petal");
    petal.style.transformOrigin = "32px 32px";
    group.append(petal);
    svg.append(group);
  }
  return svg;
}

/** A moment's time of day in Bulgaria: „00:15“. */
function clockAt(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit" }).format(
    new Date(ms),
  );
}

/** Where the reminder's asks are kept, on this device (notifications are a device's): lib/keep.ts, RemindAsks. */
const remindKey = "almanac.remind-ask";

/** The day played, in its card for tomorrow: shall we remind the player? By notification where one can come and isn't
 * on yet. Where none can (an iPhone in a browser tab, a browser without them, or one told to refuse them, there and
 * then too), by mail (keep.ts, mailAsk: a guest's email, proved by its code, keeps the game as well), unless it's on
 * already; never in an app's own browser, where the way out to the phone's leads (keep.ts, exitWay). At most three times,
 * and never twice in a day. `mailing`: the ask by mail is asking a guest for an email, or was told „Не сега“ today
 * (one „Не сега“ is enough for the email asked for both ways). */
function remindAsk(
  day: string,
  stake: () => string | null,
  signedIn: () => void,
  primary = false,
): { view: Child; mailing: () => boolean; showing: () => boolean; deciding: () => boolean } {
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
  const refused = () => typeof Notification !== "undefined" && Notification.permission === "denied";
  const by = signal<"push" | "mail" | null>(pushable() && !refused() ? "push" : app ? null : "mail");
  // "deciding": whether to ask is still being found out (notifications on already? the mail on?).
  const state = signal<"deciding" | "ask" | "on" | "gone">("gone");
  const mailNo = signal(asked.mailNo === day);
  const mailing = () => by() === "mail" && (state() === "ask" || mailNo()) && !user()?.email;
  const showing = () => state() === "ask" || state() === "on";
  const deciding = () => state() === "deciding";
  if (asked.n >= 3 || asked.day === day || !by.peek()) return { view: null, mailing, showing, deciding };
  const ask = () => state.set("ask");
  const gone = () => state.set("gone");
  if (by.peek() === "push") {
    state.set("deciding");
    pushOn().then((on) => (on ? gone() : ask()), gone);
  } else if (user.peek()?.email) {
    state.set("deciding");
    api<{ day: boolean; can: boolean }>("GET", "/api/mail/prefs").then((p) => (p.can && !p.day ? ask() : gone()), gone);
  } else ask();
  const error = signal("");
  const yes = async () => {
    error.set("");
    try {
      const why = await turnOn();
      if (!why) {
        save(remindAnswered(asked, "push", day, true));
        state.set("on");
      } else if (refused() && !app) {
        // Told no just now: the mail, then, an ask of its own.
        error.set(why);
        by.set("mail");
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
  };
  const view = () => {
    if (!showing()) return null;
    if (state() === "on")
      return h(
        "p",
        { class: "muted", role: "status" },
        "Готово. Ще ти напомняме около часа, в който играеш, ако броят още те чака.",
      );
    if (by() === "mail")
      return [
        () => error() && h("p", { class: "muted" }, error()),
        mailAsk({
          stake,
          no,
          primary,
          signedIn,
          yes: () => save(remindAnswered(asked, "mail", day, true)),
        }),
      ];
    return [
      h("p", { class: "muted" }, "Да ти напомняме, ако броят още те чака? Веднъж на ден, около часа, в който играеш."),
      h(
        "div",
        { class: "remind-actions" },
        h("button", { class: primary ? "btn primary" : "btn", type: "button", onclick: yes }, "Напомняй ми"),
        h("button", { class: "link tap", type: "button", onclick: no }, "Не сега"),
      ),
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
    ];
  };
  return { view, mailing, showing, deciding };
}
