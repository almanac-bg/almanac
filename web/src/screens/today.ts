// Начало: where every game starts, on one short screen, and the day is its heart. At the top the player's streak
// (and, once, what came of the days just missed — a day the week forgave, a streak ended, or a welcome back after
// days away — or, one line at a time, of a friend's yes to a request, a friend's duel waiting); then the day's
// ten questions, the same for everyone, once, as the day's issue
// („Брой 6“, play/issue.go) (left half-way, where the player stopped and the
// way on, and the streak at stake while they wait; once played, as it lands, how they went and the one gold thing to
// do next (game/gold.ts: another game, of the topic played least), and tomorrow; on a later visit, the day played in
// one short card, another game the gold thing to do); and every other way to play a tap away: by topic, and — once a
// first game is finished — with others. The day's boards are in Класации. The day played is shared from its result
// (game/share.ts); a shared day's link opens here (sharedDay), the same ten offered while their day lasts.

import { picture } from "../art/picture.ts";
import { nextGame } from "../game/gold.ts";
import { news } from "../game/news.ts";
import { closeWords, percent, rare } from "../game/numbers.ts";
import { boardRow, hands, landed, nextSteps, summary } from "../game/results.ts";
import { getReady, playRun, shownHere, starting, trail } from "../game/run.ts";
import { shareDay } from "../game/share.ts";
import { standing } from "../game/standing.ts";
import type { Board, Mark, Score, State } from "../game/types.ts";
import { api, errorText, serverNow, tally } from "../lib/api.ts";
import { boot } from "../lib/boot.ts";
import { dayInBulgaria } from "../lib/day.ts";
import { type Child, h, onCleanup, signal, slot } from "../lib/dom.ts";
import { reportProblem } from "../lib/errors.ts";
import { type RemindAsks, remindAnswered, remindAsks, remindShown } from "../lib/keep.ts";
import { pushable, pushOn, turnOn } from "../lib/push.ts";
import { go, goBack, hold, release, title } from "../lib/router.ts";
import { feelKit } from "../lib/sound.ts";
import { dateWords, issueWords, onDay, weekday } from "../lib/words.ts";
import { categories, notice, player, playing, user } from "../state.ts";
import { dayPointsWords, failure, formatNumber, stakeLine } from "../ui.ts";
import { type Accepted, acceptedLine, type Waiting, waitingLine } from "./duel.ts";
import { app, haveProfile, keepLine, keepStake, mailAsk } from "./keep.ts";
import { modes } from "./modes.ts";
import { topics } from "./play.ts";
import { loadStats, type Stats } from "./stats.ts";

export interface Today {
  day: string;
  /** The day's issue: its number from the first day of the day's ten (play/issue.go), the same for everyone. */
  issue?: number;
  streak: number;
  /** Whether this week would still forgive a day missed (play/runs.go: one a week). */
  spare?: boolean;
  /** A day just missed that the week forgave (the last 3 days). */
  forgiven?: string;
  /** A streak that just ended (the last 3 days): its days, and the day missed that ended it. */
  ended?: { days: number; on: string };
  /** Whether the player has finished a game of any kind: until then Начало is the day and the topics only. */
  played?: boolean;
  run: State | null;
  /** The day played: the right answer the fewest of its other players got (its place, their share right). */
  rarest?: { n: number; right: number } | null;
  board: Board;
  /** The day among the player and their friends, best first: once a friend has played it (null before). */
  friends?: Score[] | null;
  /** While no friend has played: whether the player has any friends at all. */
  befriended?: boolean;
  /** A friend said yes to the player's request: told once (play/lines.go). */
  accepted?: Accepted | null;
  /** A friend's duel waits for the player (play.DuelWaiting): a quiet line while it does. */
  duel?: Waiting | null;
  /** A game that ended without its result on screen (the day's last question let run out, a game left at its end):
   * its news, told here once (play/told.go). */
  untold?: number;
  /** Back after days away, the streak ended since (play.BackFrom): the last day played and the longest streak, said
   * once. */
  back?: { last: string; best: number };
}

/** The day as Начало's page came with it (server/pages.go): its first draw, without asking; every later one asks. */
let inPage = boot.day as Today | undefined;

/** A day shared (server/share.go): its day, its issue, and its shape (each question that counts: '1' right, '0' not). */
interface Shared {
  day: string;
  issue: number;
  shape: string;
}

/** The day shared by the link the page was opened at, until Начало has taken it (sharedDay). */
let invite = (boot.shared as Shared | undefined) ?? null;

/** A shared day's link (/d/<issue>-<code>), opened: Начало, which says the day shared once (today). The address
 * becomes Начало's, so that a reload, or the address copied from the bar, is the day's and not the share's. */
export function sharedDay(): Child {
  go("/", true);
  return null;
}

export function today() {
  title();
  // Come by a shared day's link: while it's still that day, its score and shape over the same ten, „Колко ще познаеш
  // ти?“; once it's over, a line that it is, over today's.
  const shared = invite;
  invite = null;
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
  load();
  return h("div", null, screen);

  /** The screen itself: the day as it stands (`run` its result, if played; `just`: played this moment, so what it
   * earned is told once), then the ways to play. */
  function home(t: Today, run: State | null, just: boolean): Child {
    // Just played: the streak and the place it made, as they are now. The moments come one after another, never over
    // each other: the result lands, then the streak rolls on in its chip (feel.ts), and only then what's big (news.ts:
    // a sheet, for a note in the book), never over the chip rolling on.
    const fresh = signal<Today>(t);
    const now = just ? api<Today>("GET", "/api/day") : null;
    now?.then(fresh.set, () => {});
    let growing: Promise<void> | null = null;
    const streak = now && {
      // Once the day as it is now has come and drawn the chips (signals run at once): their growing, if any.
      grown: now.then(
        () => growing ?? undefined,
        () => undefined,
      ),
    };
    // Or a profile just signed in to here (haveProfile): what came of it; or a shared day that's over.
    const said =
      bye ||
      notice.peek() ||
      (shared && shared.day !== t.day && !run?.done ? `Брой ${shared.issue} вече мина. Ето днешния.` : "");
    bye = "";
    notice.set("");
    // The player's numbers (Профил's), for the topics' tiles and where another game goes: the topic played least
    // (game/gold.ts), „Микс“ until they come.
    const numbers = user.peek() ? loadStats() : null;
    const mine = signal<Stats | null>(null);
    numbers?.then(mine.set, () => {});
    const next = () =>
      nextGame(
        mine()?.mastery,
        categories.map((c) => c.id),
      );
    // The day played: in full as it lands (or when its result was never on screen: what it
    // earned is told with it); on a later visit, one short card (dayDone), with the ways to play right under it.
    const full = !!run?.done && (just || t.untold === run.id);
    const tomorrow = run?.done
      ? tomorrowCard(
          t.day,
          () => (just && fresh() === t ? 0 : fresh().streak),
          // A guest is asked to keep the game (screens/keep.ts): what it risks till then.
          // The days played as far as they count (1 or 2): a streak of two is a habit begun.
          keepStake(
            () => (fresh().streak >= 2 ? 2 : 1),
            () => fresh().streak,
          ),
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
        // What came of the days just missed, once.
        streakNotice(t),
        // One line at a time, of others: a friend's duel waits (it has a time), or a friend said yes to their request
        // (told once: it waits for its turn).
        waitingLine(t.duel) ?? acceptedLine(t.accepted),
        // Come from the streak's mail to a browser signed out: the way in comes first, open.
        fromMail && !user.peek()?.email ? haveProfile(load, undefined, true) : null,
        run?.done && !full
          ? [
              // A later visit: the day played as one short card, and the ways to play right under it.
              dayDone(t, run, next),
              tomorrow,
            ]
          : run?.done
            ? summary(
                run,
                [
                  h("div", { class: "day-line" }, h("span", { class: "kicker" }, issueWords(t.issue, t.day)), () =>
                    placeLink(fresh(), !t.played),
                  ),
                  // How it went among everyone, from ten players (game/standing.ts), else how many right is usual
                  // today; and the right answer few others got, in gold.
                  () => {
                    const lines = [crowdSays(fresh(), !t.played), rareLine(fresh().rarest)];
                    return lines.some(Boolean) ? h("div", null, lines) : null;
                  },
                ],
                // Right under it, what to do next: one gold action (game/gold.ts), and the day to share.
                { ...dayNext(next), also: [shareButton(run)] },
                // Tomorrow (when the next ten come, the streak, the reminder); then the friends' day, and what the
                // game brought (a day whose result was never on screen: told now, once). Just played, the streak
                // waits for the day as it is now, with today in it.
                [tomorrow, () => friendsDay(fresh()), just ? news(run.id, 0, streak ?? undefined) : untold(t, run.id)],
                dayPointsWords,
                just,
              )
            : dayCard(t, start(t), run?.trail ?? [], failed, shared?.day === t.day ? shared : null),
        // Before a first game, a player who has a profile already (a new phone) signs in, a tap away: under the day, so
        // that a new player's Начало is one column, on a big screen too.
        just || t.played || user.peek()?.email || fromMail ? null : haveProfile(load),
      ),
      h(
        "div",
        { class: "home-side" },
        // Another game whose result was never on screen: what it earned, told here once, before what's next.
        just ? null : untold(t),
        // The ways to play with others wait for a first game finished: a new player starts with the day and a topic.
        just || t.played ? modes(["duel"], "С други") : null,
        // A later visit: the friends' day after the ways to play (beside the day on a big screen).
        run?.done && !full ? () => friendsDay(fresh()) : null,
      ),
      topics(numbers ?? undefined),
    );
  }
}

/** What to do next under the day's result: the one gold action (game/gold.ts), another game, of the topic played
 * least (`next`). */
function dayNext(next: () => string): { main: Child } {
  return { main: () => h("a", { class: "btn primary big", href: next() }, "Още десет") };
}

/** The day played among everyone (game/standing.ts): the way to the day's board, said by the place where it's worth
 * saying. */
function placeLink(t: Today, early: boolean): Child {
  const s = standing(t.board.place, t.board.players, early);
  return s ? h("a", { class: "place-line", href: "/ranks" }, s.place ? `${s.place} днес` : "Класацията на деня") : null;
}

/** How the day played went among everyone: the share of players it did better than, where that's said
 * (game/standing.ts; `early`: on a first day), and, from ten players, how many right is usual today (`one`: only the
 * first of them). */
function crowdSays(t: Today, early: boolean, one = false): Child {
  const lead = standing(t.board.place, t.board.players, early)?.lead;
  const avg = t.board.average;
  const lines = [
    lead ? h("p", { class: "crowd-says" }, lead) : null,
    avg && !(one && lead)
      ? h("p", { class: "crowd-says" }, `Средно днес: ${formatNumber(avg, 0.1)} от ${t.board.of}.`)
      : null,
  ].filter(Boolean);
  return lines.length ? lines : null;
}

/** The day played, on a later visit (its moment is over): one short card — its dateline and place, the score and its
 * points, the pips — with the gold way to another game under it, and the questions gone over on their own page. */
function dayDone(t: Today, run: State, next: () => string): Child {
  const ways = dayNext(next);
  return h(
    "section",
    { class: "card day-done" },
    h("div", { class: "day-line" }, h("span", { class: "kicker" }, issueWords(t.issue, t.day)), placeLink(t, false)),
    h(
      "p",
      { class: "day-done-score" },
      h("b", { class: "day-done-n" }, String(run.rights)),
      h("span", { class: "num-word" }, " от "),
      h("b", { class: "day-done-of" }, String(run.total - (run.void ?? 0))),
      h("span", { class: "num-word" }, closeWords(run.trail)),
      h("span", { class: "day-done-points" }, `${formatNumber(run.points)} ${run.points === 1 ? "точка" : "точки"}`),
    ),
    crowdSays(t, false, true),
    trail(run.trail, run.total),
    nextSteps(ways.main, [h("a", { class: "btn", href: `/games/${run.id}` }, "Прегледай въпросите"), shareButton(run)]),
  );
}

/** „Сподели резултата“ (game/share.ts): the day's text sent on, or copied (the button says „Копирано“ a moment);
 * where neither can be done, the text in its place, to copy by hand. */
function shareButton(run: State): Child {
  const now = signal<"" | "busy" | "copied">("");
  const byHand = signal("");
  const error = signal("");
  const press = async () => {
    if (now.peek() === "busy") return;
    now.set("busy");
    error.set("");
    try {
      const out = await shareDay(run.id);
      now.set(out === "copied" ? "copied" : "");
      if (typeof out === "object") byHand.set(out.text);
      if (out === "copied") setTimeout(() => now.peek() === "copied" && now.set(""), 2500);
    } catch (err) {
      now.set("");
      error.set(errorText(err));
    }
  };
  return () =>
    byHand()
      ? h(
          "textarea",
          {
            class: "share-text",
            readonly: true,
            rows: 3,
            "aria-label": "Резултатът за споделяне",
            onfocus: (e: Event) => (e.target as HTMLTextAreaElement).select(),
          },
          byHand(),
        )
      : h(
          "span",
          { class: "share" },
          h(
            "button",
            { class: "btn", type: "button", onclick: press, "aria-busy": () => (now() === "busy" ? "true" : null) },
            () => (now() === "copied" ? "Копирано" : "Сподели резултата"),
          ),
          () => (error() ? h("span", { class: "bad", role: "alert" }, error()) : null),
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

/** The streak notices told on this page: the server keeps them as told (play.TellStreak), and each is said once. */
const toldHere = new Set<string>();

/** Keeps a streak notice as told, on the server, so that no other device (or private window) tells it again. */
function tellStreak(key: string): boolean {
  if (toldHere.has(key)) return false;
  toldHere.add(key);
  api("POST", "/api/me/streak-told", { key }).catch(() => toldHere.delete(key));
  return true;
}

/** What came of the days just missed — the week forgave one, or it had forgiven one already and the streak ended — or, back after
 * days away, a welcome with the longest streak the player has had: said once, above the day (the server sends it
 * until it's told). */
function streakNotice(t: Today): Child {
  const key = t.forgiven
    ? `forgiven:${t.forgiven}`
    : t.ended
      ? `ended:${t.ended.on}`
      : t.back
        ? `back:${t.back.last}`
        : "";
  if (!key || !tellStreak(key)) return null;
  const begins = t.run?.done ? "Днес започна нова" : "Днес започва нова";
  const best = t.back?.best ?? 0;
  const text = t.forgiven
    ? `${onDay(t.forgiven).replace(/^./, (c) => c.toUpperCase())} пропусна въпросите, но серията остава: един пропуснат ден в седмицата не я прекъсва. Серия: ${t.streak === 1 ? "1 ден" : `${t.streak} дни`}.`
    : t.ended
      ? `Серията ти от ${t.ended.days} дни прекъсна. ${begins}.`
      : best > 1
        ? `Радваме се, че се върна. Най-дългата ти серия е ${best} дни. ${begins}.`
        : `Радваме се, че се върна. ${begins} серия.`;
  return h("p", { class: "streak-notice", role: "status" }, picture("flame", "notice-pic"), text);
}

/** The streak, a tap from Профил, where there's more of it. While the day's ten wait, the streak is at stake: its
 * flame unlit, its number still there, until the day played lights it (grow). A plain „0 дни поред“ reads as a scold:
 * without a streak there's no chip, until the day played starts one. */
function status(t: Today): HTMLElement | null {
  const days = t.streak;
  if (!days) return null;
  return h(
    "div",
    { class: "status-row" },
    h(
      "div",
      { class: "streak-wrap" },
      h(
        "a",
        { class: `status-item streak-chip${t.run?.done ? "" : " unlit"}`, href: "/me" },
        h("span", { class: "status-icon" }, picture("flame", "flame status-flame")),
        h(
          "span",
          { class: "status-text" },
          h("b", { class: "status-n" }, String(days)),
          h("span", { class: "status-label" }, streakLabel(days)),
        ),
      ),
    ),
  );
}

/** The streak's words beside its number. */
const streakLabel = (n: number) => (n === 1 ? "ден поред" : "дни поред");

/** The streak just grown by the day played (`was` before it, `now` after), moved there in its chip once the result
 * has landed (`after`): its number rolls on. Resolves once it's over, for what's big to come after it (news.ts), never
 * over it. Without the game's feel loaded, or with less motion, it is simply as it is. */
async function grow(row: HTMLElement, was: Today, now: Today, after: Promise<void>): Promise<void> {
  const kit = feelKit();
  const streak = row.querySelector<HTMLElement>(".streak-chip");
  if (!kit || !streak || now.streak !== was.streak + 1) return;
  // The flame stays as it was before the day (unlit, or cold without a streak) until its number rolls on: then it
  // lights, swelling once.
  const off = was.streak ? "unlit" : "cold";
  streak.classList.add(off);
  after.then(() => streak.classList.remove(off));
  await kit.streak(streak, now.streak, streakLabel, after, hands());
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The day's ten, not played yet, as the day's issue: its dateline (the weekday and the issue over the date, set
 * large), what they are, and the gold button; or, left half-way (`marks`: how the questions answered went), where the
 * player stopped, the pips so far, and the way on from there; and what went wrong starting them (`error`). Before
 * play there are no pips: they'd measure nothing yet. */
function dayCard(t: Today, start: () => void, marks: Mark[], error: string, shared: Shared | null): Child {
  const players = t.board.players;
  const at = marks.length;
  // Come by a shared day's link, before playing: the score shared and its shape lead, and the question is the player's.
  const lead = shared && !at ? shared : null;
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
      lead ? sharedScore(lead) : null,
      h("h1", { class: "day-title" }, lead ? "Колко ще познаеш ти?" : "Десет въпроса за днес"),
      h(
        "p",
        { class: "muted" },
        at
          ? `Следва въпрос ${at + 1} от 10. Довърши играта до полунощ.`
          : lead
            ? "Същите десет въпроса чакат и теб: по един от всяка тема, от лесен към труден, с един опит."
            : "По един от всяка тема, от лесен към труден. Едни и същи за всички, с един опит.",
      ),
      stakeLine(t.streak, t.spare ?? true),
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

/** A shared day's score, as its link brought it: „7 от 10“ and its shape, a pip each, no answers. */
function sharedScore(s: Shared): Child {
  const marks: Mark[] = [...s.shape].map((c) => ({ points: 0, right: c === "1" }));
  const rights = marks.filter((m) => m.right).length;
  return h(
    "div",
    { class: "shared-score" },
    h("p", { class: "kicker" }, "Споделен резултат"),
    h("p", { class: "shared-score-n" }, h("b", null, String(rights)), ` от ${marks.length}`),
    trail(marks, marks.length),
  );
}

/** The right answer of the day played that the fewest of its other players got, told in gold if few did. */
function rareLine(r?: { n: number; right: number } | null): Child {
  if (!r || r.right > rare) return null;
  const who = r.right ? `го знаят само ${percent(r.right)} от играчите` : "не го знае никой друг";
  return h("p", { class: "crowd-says rare" }, `Позна въпрос ${r.n + 1}: днес ${who}.`);
}

/** The friends' day beside the result: the best five (the player's own row in place of the fifth if further down),
 * each with how their ten went, and the way to them all; for a player without friends, one quiet line to add one.
 * Shown once the day as fetched has the player on it. */
function friendsDay(t: Today): Child {
  const all = t.friends ?? [];
  if (!all.length)
    return t.befriended === false
      ? h(
          "p",
          { class: "day-next" },
          h("a", { href: "/friends" }, "Добави приятел и сравнявайте резултатите си всеки ден."),
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
        const row = boardRow(i + 1, s.name, [String(s.rights), h("small", { class: "sub" }, ` от ${s.of}`)], {
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
 * Bulgaria), what they make of the streak (`streak`: with today's), a guest's ask to keep the game (`stake`: what it risks till then), and, where it isn't on yet, the
 * reminder's ask, which by mail asks for the email the keeping would. */
function tomorrowCard(day: string, streak: () => number, stake: () => string | null): Child {
  const left = signal(untilMidnight());
  const t = setInterval(() => left.set(untilMidnight()), 30_000);
  onCleanup(() => clearInterval(t));
  const ask = remindAsk(day, stake);
  return h(
    "section",
    { class: "card keep-card tomorrow" },
    h("h2", { class: "card-title" }, "Утре — нови десет"),
    h("p", { class: "muted" }, () => {
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
  const refused = () => typeof Notification !== "undefined" && Notification.permission === "denied";
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
