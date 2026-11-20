// Днес, the first of the three places: the day's issue. Its dateline („Брой 9“ · „Петък, 20 ноември“), the date set
// large, „Десет въпроса за днес.“ and „Започни“ (left half-way, where the player stopped and „Продължи“; come by a
// shared day's link, the score shared over the same ten). A new visitor has the cover alone; a player has beside it
// the streak and this week, the friends' day, and the way to their book. Once the day is played, the issue is its
// result (as it lands, and on every later visit): the score and its shape, how it went among everyone, sharing it
// (game/share.ts, in a sheet with its card and its text), how all of България did with it, one entry its right answers
// wrote in the book (the rarest, once enough others played the day), and tomorrow (when the next issue comes, the streak it makes, the reminder's ask). A wrong game is
// never celebrated. Topics are played from their chapter in the Алманах, duels from Приятели. Once, over the day: what
// came of the days just missed, a friend's duel waiting, a friend's yes. In an app's own browser the result's action
// is the way out to the phone's browser with the game (keep.ts, exitWay), and the cover has a line for a game kept
// there; a game brought here by it (its token in the address's fragment: takeHand) lands on the result, whose action
// is then the ask to keep it and be reminded.

import { picture } from "../art/picture.ts";
import { news } from "../game/news.ts";
import { closeWords, count, percent } from "../game/numbers.ts";
import { hands, land, landed, reviewed } from "../game/results.ts";
import { getReady, playRun, shownHere, starting, trail } from "../game/run.ts";
import { shareDay, shareText } from "../game/share.ts";
import { standing } from "../game/standing.ts";
import type { Board, Mark, Reviewed, Score, State } from "../game/types.ts";
import { api, errorText, serverNow, tally } from "../lib/api.ts";
import { boot } from "../lib/boot.ts";
import { dayInBulgaria } from "../lib/day.ts";
import { type Child, h, onCleanup, signal, slot } from "../lib/dom.ts";
import { handToken } from "../lib/embedded.ts";
import { reportProblem } from "../lib/errors.ts";
import { type RemindAsks, remindAnswered, remindAsks, remindShown } from "../lib/keep.ts";
import { pushable, pushOn, turnOn } from "../lib/push.ts";
import { go, goBack, hold, release, title } from "../lib/router.ts";
import { feelKit } from "../lib/sound.ts";
import { dateWords, issueOf, onDay, weekday } from "../lib/words.ts";
import { cover, notice, player, playing, topics, user } from "../state.ts";
import { failure, formatNumber, rankRow, rightsOf, stakeLine, weekStrip } from "../ui.ts";
import { type Accepted, acceptedLine, type Waiting, waitingLine } from "./duel.ts";
import { app, coverExit, exitWay, handedIn, haveProfile, keepLine, keepStake, mailAsk, takeHand } from "./keep.ts";
import { loadStats, type Stats } from "./stats.ts";

/** The entry of the day played that its result shows (play.DayEntry): its place, its fact as the book has it, and
 * whether there's a crowd (enough of the day's others played it) to say how few got it (`right`, their share): then it
 * is the rarest right answer with a fact; without one, the hardest, and nothing is said of others. */
interface DayEntry {
  n: number;
  crowd: boolean;
  right: number;
  fact: { category: string; question?: string; answer: string; untrue?: boolean; fact: string };
}

export interface Today {
  day: string;
  /** The day's issue: its number from the first day of the day's ten (play/issue.go), the same for everyone. */
  issue?: number;
  /** The issue's topics, in the order its ten are asked (play.IssueTopics): „В броя“. */
  topics?: string[] | null;
  streak: number;
  /** Whether this week would still forgive a day missed (play/runs.go: one a week). */
  spare?: boolean;
  /** A day just missed that the week forgave (the last 3 days). */
  forgiven?: string;
  /** How many missed days a week the streak forgives the player (play.StreakNow.PerWeek). */
  perWeek?: number;
  /** A streak that just ended (the last 3 days): the day missed that ended it. How many days it had is never said. */
  ended?: { on: string };
  /** Whether today is the player's first day (no game finished before it): the same all day, whatever they play. */
  firstDay?: boolean;
  run: State | null;
  /** The day played: the entry its right answers wrote in the book that the result shows (none for no right answer
   * with a fact). */
  entry?: DayEntry | null;
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
  /** Back after days away, the streak ended since (play.BackFrom): the last day played (no streak's number), said
   * once. */
  back?: { last: string };
}

/** The day as Днес's page came with it (server/pages.go): its first draw, without asking; every later one asks. */
let inPage = boot.day as Today | undefined;

/** A day shared (server/share.go): its day, its issue, and its shape (each question that counts: '1' right, '0' not). */
interface Shared {
  day: string;
  issue: number;
  shape: string;
}

/** The day shared by the link the page was opened at, until Днес has taken it (sharedDay). */
let invite = (boot.shared as Shared | undefined) ?? null;

/** A shared day's link (/d/<issue>-<code>), opened: Днес, which says the day shared once (today). The address
 * becomes Днес's, so that a reload, or the address copied from the bar, is the day's and not the share's. */
export function sharedDay(): Child {
  go("/", true);
  return null;
}

/** Each day played's questions gone over (its review), asked for once: the hardest of the day and the list „Прегледай въпросите“ opens all read the one answer. */
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
  // A game brought from an app's own browser: its token in the address's fragment (keep.ts, exitWay), taken out of
  // the address at once and taken here (takeHand), not in an app's browser (the one it came from, reloaded).
  const hand = handToken(location.hash);
  if (hand) history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  const load = async () => {
    try {
      const t = inPage ?? (await api<Today>("GET", "/api/day"));
      inPage = undefined;
      day = t.day;
      const run = t.run;
      // A question this tab was showing has its time running (a reload): straight back into it. Otherwise (another
      // device, or tab) the day left half-way waits on Днес for „Продължи“: no question's time starts without a tap.
      if (run && !run.done && run.question && shownHere(run.id))
        screen.show(() => playRun(run, (s) => home(t, s, true)));
      else screen.show(() => home(t, t.run, false));
    } catch (err) {
      screen.show(() => failure(err, load, null));
    }
  };
  // The day's ten (or the rest of them) start after the count every game has, which „Откажи“ backs out of: nothing
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
    const notices = [
      said ? h("p", { class: "notice", role: "status" }, said) : null,
      // What came of the days just missed, once.
      streakNotice(t),
      // One line at a time, of others: a friend's duel waits (it has a time), or a friend said yes to their request.
      waitingLine(t.duel) ?? acceptedLine(t.accepted),
      // Come from the streak's mail to a browser signed out: the way in comes first, open.
      fromMail && !user.peek()?.email ? haveProfile(load, undefined, true) : null,
    ];
    if (run?.done) return result(t, run, just, notices);
    // The player's numbers (Профил's): the streak's week, the facts in the book.
    const stats = signal<Stats | null>(null);
    if (user.peek()) loadStats().then(stats.set, () => {});
    const first = !user.peek();
    return h(
      "section",
      { class: first ? "screen today first spread" : "screen today spread" },
      h("div", { class: "notices" }, notices),
      dateline(t, first),
      issue(t, start(t), run?.trail ?? [], failed, shared?.day === t.day ? shared : null, first),
      first
        ? null
        : h(
            "aside",
            { class: "today-side page-2" },
            streakSection(t, stats, false),
            friendsToday(t),
            bookLink(stats),
            untold(t),
          ),
    );
  }
}

/** The issue's dateline under the frame's double rule: its number, and the day. */
function dateline(t: Today, full: boolean): Child {
  const year = full ? ` ${t.day.slice(0, 4)}` : "";
  return h(
    "div",
    { class: "dateline" },
    h("span", null, `Брой ${t.issue ?? issueOf(t.day)}`),
    h("span", null, `${weekday(t.day)}, ${dateWords(t.day)}${year}`),
  );
}

/** The day's ten, not played yet, as the day's issue: the date set large, what they are, and „Започни“; or, left
 * half-way (`marks`: how the questions answered went), where the player stopped, its shape so far, and „Продължи“;
 * and what went wrong starting them (`error`). Come by a shared day's link (`shared`), the score shared and its shape
 * lead, and the question is the player's. Before play there's no shape: it would measure nothing yet. */
function issue(
  t: Today,
  start: () => void,
  marks: Mark[],
  error: string,
  shared: Shared | null,
  first: boolean,
): Child {
  const players = t.board.players;
  const at = marks.length;
  const lead = shared && !at ? shared : null;
  const [, , date = 1] = t.day.split("-").map(Number);
  return h(
    "div",
    { class: "issue day page-1" },
    h(
      "p",
      { class: "issue-date" },
      h("time", { datetime: t.day }, h("b", { class: "issue-n" }, String(date))),
      " ",
      h(
        "span",
        { class: "issue-month" },
        dateWords(t.day).split(" ")[1] ?? "",
        first ? h("span", { class: "kicker issue-weekday" }, weekday(t.day)) : null,
      ),
    ),
    h(
      "div",
      { class: "issue-body" },
      lead ? sharedScore(lead) : null,
      h("h1", { class: "issue-title" }, lead ? "Колко ще познаеш ти?" : "Десет въпроса за днес."),
      h(
        "p",
        { class: "deck" },
        at
          ? `Следва въпрос ${at + 1} от 10. Довърши ги до полунощ.`
          : lead
            ? "Същите десет въпроса чакат и теб: по един от всяка тема, от лесен към труден."
            : first
              ? "Едни и същи за цяла България. По един от всяка тема, от лесен към труден."
              : "Едни и същи за цяла България.",
      ),
      at ? trail(marks, 10, at) : null,
      h("button", { class: "btn primary issue-go", onclick: start }, at ? "Продължи" : "Започни"),
      first && !at ? coverExit() : null,
      error ? h("p", { class: "bad", role: "alert" }, error) : null,
      at
        ? null
        : h(
            "p",
            { class: "small issue-meta" },
            // Who has played today, once someone has: a zero says only that the place is empty.
            players
              ? `Около три минути · Днес ${players === 1 ? "игра 1 човек" : `играха ${formatNumber(players)} души`}`
              : "Около три минути",
          ),
      contents(t),
    ),
  );
}

/** The issue's contents on a big screen („В броя“): its ten topics in their order, each with its chapter's colour. */
function contents(t: Today): Child {
  const list = t.topics ?? [];
  if (list.length < 2) return null;
  return h(
    "section",
    { class: "contents-issue", "aria-label": "В броя" },
    h("p", { class: "kicker" }, "В броя"),
    h(
      "ol",
      null,
      list.map((id, i) =>
        h(
          "li",
          { class: `t-${id}` },
          h("span", { class: "contents-n" }, String(i + 1)),
          h("span", { class: "dot" }),
          topics.find((c) => c.id === id)?.name ?? id,
        ),
      ),
    ),
  );
}

/** A shared day's score, as its link brought it: „7 от 10“ and its shape, a square each, no answers. */
function sharedScore(s: Shared): Child {
  const marks: Mark[] = [...s.shape].map((c) => ({ right: c === "1" }));
  const rights = marks.filter((m) => m.right).length;
  return h(
    "div",
    { class: "shared-score" },
    h("p", { class: "kicker" }, "Споделен резултат"),
    h("p", { class: "shared-score-n" }, h("b", null, String(rights)), ` от ${marks.length}`),
    trail(marks, marks.length),
  );
}

/** The streak: its number and this week, a square a day (played filled, today ringed in gold, the day forgiven), and
 * a line of what the day makes of it. While the day's ten wait (`done` false) the streak is at stake; once played,
 * its number rolls on (grow). Nothing while there's no streak and nothing played. */
function streakSection(t: Today, stats: () => Stats | null, done: boolean): Child {
  return () => {
    const s = stats();
    const days = t.streak;
    if (!days && !done) return null;
    const unit = days === 1 ? "ден поред" : "дни поред";
    // While the day waits, what it makes of the streak, and from the evening, if the week has forgiven its day
    // already, that it ends (stakeLine: read again each minute).
    const note = done
      ? h("p", { class: "streak-note" }, `Утрешният брой я прави ${days + 1}.`)
      : [
          stakeLine(days, t.spare ?? true),
          h(
            "p",
            { class: "streak-note" },
            (t.spare ?? true) ? forgivesWords(t.perWeek) : "Тази седмица простените дни вече са използвани.",
          ),
        ];
    return h(
      "section",
      { class: "sect today-streak" },
      h("div", { class: "sect-head" }, h("h2", null, "Серия")),
      h(
        "div",
        { class: "streak-row" },
        h(
          "a",
          { class: done ? "streak-chip" : "streak-chip unlit", href: "/me", "aria-label": `Серия: ${days} ${unit}` },
          h(
            "span",
            { class: "status-text" },
            h("b", { class: "status-n" }, String(days)),
            h("span", { class: "status-label" }, unit),
          ),
        ),
        s ? weekStrip(s.week, s.forgiven) : null,
      ),
      note,
    );
  };
}

/** The friends' day: who has played it and how, best first, the way to them all in Приятели; for a player without
 * friends, one quiet line to add one. */
function friendsToday(t: Today): Child {
  const all = (t.friends ?? []).filter((s) => !s.me);
  return h(
    "section",
    { class: "sect today-friends" },
    h(
      "div",
      { class: "sect-head" },
      h("h2", null, "Приятели днес"),
      h("a", { class: "link sect-note", href: "/friends" }, "Всички"),
    ),
    all.length
      ? h(
          "ol",
          { class: "rows ranks" },
          all.slice(0, 5).map((s) => rankRow(s.name, { look: s, tag: s.tag, score: rightsOf(s.rights, s.of) })),
        )
      : h(
          "p",
          { class: "today-none" },
          t.befriended === false
            ? h("a", { href: "/friends" }, "Добави приятел и сравнявайте резултатите си всеки ден.")
            : "Още никой от приятелите ти не е играл днес.",
        ),
  );
}

/** The way to the player's book: the seal it gives them, if any. */
function bookLink(stats: () => Stats | null): Child {
  return () => {
    const s = stats();
    if (!s) return null;
    return h(
      "section",
      { class: "sect today-book" },
      h("div", { class: "sect-head" }, h("h2", null, "Твоят Алманах")),
      h(
        "a",
        { class: "book-link", href: "/almanac" },
        picture("mode-almanac", "book-pic"),
        h(
          "p",
          { class: "book-words" },
          s.seal
            ? [h("strong", null, `${s.seal.name}.`), " Всеки верен отговор в броя записва факт с мастило."]
            : "Всеки верен отговор в броя записва по един факт с мастило в главата на темата си.",
        ),
        h("span", { class: "i i-right book-go", "aria-hidden": "true" }),
      ),
    );
  };
}

/** A count of right answers in words, as the result's line opens: „Седем верни.“ */
const rightWords = [
  "Нито един верен.",
  "Един верен.",
  "Два верни.",
  "Три верни.",
  "Четири верни.",
  "Пет верни.",
  "Шест верни.",
  "Седем верни.",
  "Осем верни.",
  "Девет верни.",
  "Всичките десет верни.",
];

/** How many a day's right answers are out of: all but those that count for nobody (Mark.void). */
const outOf = (s: State) => s.total - (s.void ?? 0);

/** The day played, as a page: the score and its shape, how it went among everyone, sharing it; how all of България did
 * with it and an entry its right answers wrote, as the book has it; tomorrow; the questions, once opened. As it's played
 * (`just`), it lands (feel.ts: the shape, the score, the streak rolling on) and what it brought is told; on a later
 * visit it is as it is. */
function result(t: Today, run: State, just: boolean, notices: Child[]): Child {
  const fresh = signal<Today>(t);
  const now = just ? api<Today>("GET", "/api/day") : null;
  now?.then(fresh.set, () => {});
  let growing: Promise<void> | null = null;
  const of = outOf(run);
  const perfect = of > 0 && run.rights === of;
  const review = reviewOf(run.id);
  const reviewList = signal<Reviewed[] | null>(null);
  let reviewHead: HTMLElement | null = null;
  const openReview = async () => {
    reviewList.set(await review.catch(() => null));
    requestAnimationFrame(() => {
      reviewHead?.focus({ preventScroll: true });
      reviewHead?.scrollIntoView({ block: "start" });
    });
  };
  const hero = h(
    "div",
    { class: "result-score" },
    perfect ? h("div", { class: "perfect-head" }, seal(), h("p", { class: "kicker" }, "Всички верни")) : null,
    h("p", { class: "kicker" }, `Твоят брой ${t.issue ?? issueOf(t.day)} · ${dateWords(t.day)}`),
    h(
      "h1",
      { class: "score" },
      h("b", { class: "score-n" }, String(run.rights)),
      h("span", { class: "score-of" }, `от ${of}`, h("span", { class: "score-close" }, closeWords(run.trail))),
    ),
    trail(run.trail, run.total),
    h("p", { class: "result-line" }, h("b", null, rightWords[Math.min(10, run.rights)] ?? ""), " ", () =>
      crowdWords(fresh(), !!t.firstDay),
    ),
  );
  if (just) land(hero, run.id, perfect, true);
  // The streak with today's, the game's stake, and the reminder's ask: the result's action where it leads, else in
  // „Утре“. A guest in an app's own browser has the way out for the action; one whose game was just brought here,
  // the ask to keep it and be reminded (while it's there to ask); everyone else, sharing the day.
  const streak = () => (just && fresh() === t ? 0 : fresh().streak);
  const stake = keepStake(
    () => (streak() >= 2 ? 2 : 1),
    () => streak(),
  );
  const ask = remindAsk(t.day, stake);
  const guest = !user.peek()?.email;
  const away = !!app && guest;
  const askFirst = !away && guest && handedIn.peek();
  const share = [shareButton(run, t), h("p", { class: "small" }, "Само резултатът и формата му, без отговорите.")];
  const streakRow = () => {
    const f = fresh();
    if (!user() || (!f.streak && !just)) return null;
    const days = just && f === t ? t.streak : f.streak;
    // Just played, the streak as it was before the day (unlit) until the day as it is now comes and it rolls on.
    const row = h(
      "a",
      { class: just && f === t ? "streak-chip result-streak unlit" : "streak-chip result-streak", href: "/me" },
      h(
        "span",
        { class: "status-text" },
        h("b", { class: "status-n" }, String(days)),
        h("span", { class: "status-label" }, streakLabel(days)),
      ),
    );
    if (f !== t && !growing)
      growing = grow(
        row,
        t,
        f,
        landed(run.id).then(() => wait(200)),
      );
    return row;
  };
  return h(
    "section",
    { class: "screen result summary spread" },
    h("div", { class: "notices" }, notices),
    h(
      "div",
      { class: "result-main page-1" },
      hero,
      streakRow,
      h(
        "div",
        { class: "result-share" },
        away ? exitWay(stake) : askFirst ? () => (ask.showing() ? ask.view : share) : share,
        h("button", { class: "link tap", type: "button", onclick: openReview }, "Прегледай въпросите"),
      ),
      // What the game brought (a day whose result was never on screen: told now, once).
      just ? news(run.id) : untold(t, run.id),
    ),
    h(
      "div",
      { class: "result-side page-2" },
      () => bulgariaToday(fresh(), run, review),
      () => entryOfDay(fresh().entry),
    ),
    tomorrow(t, streak, stake, askFirst || away ? null : ask),
    () => {
      const all = reviewList();
      if (!all) return null;
      reviewHead = h("h2", { class: "section-title review-head", tabindex: -1 }, "Въпросите");
      return h("div", { class: "result-review" }, reviewed(all, reviewHead));
    },
  );
}

/** How the day played went among everyone: the share of players it did better than, where that's said
 * (game/standing.ts; `early`: on a first day), else, from ten players, how many right is usual today. */
function crowdWords(t: Today, early: boolean): string {
  const lead = standing(t.board.place, t.board.players, early)?.lead;
  if (lead) return lead;
  const avg = t.board.average;
  return avg ? `Средно днес: ${formatNumber(avg, 0.1)} от ${t.board.of}.` : "";
}

/** How all of България did with the day: how many got each count of right answers, the player's own bar in ink with
 * „ти“ over it and the average dashed; under it the average, the tens, and the share that knew the hardest question.
 * From ten players (play.Board.Spread: people only). */
function bulgariaToday(t: Today, run: State, review: Promise<Reviewed[]>): Child {
  const spread = t.board.spread;
  if (!spread?.length) return null;
  const most = Math.max(1, ...spread);
  const avg = t.board.average ?? 0;
  const hardest = signal<{ n: number; share: number } | null>(null);
  review.then(
    (all) => {
      let low: { n: number; share: number } | null = null;
      for (const q of all) {
        const c = q.reveal.crowd;
        if (!c?.answers || q.void) continue;
        if (!low || c.right < low.share) low = { n: q.n, share: c.right };
      }
      hardest.set(low);
    },
    () => {},
  );
  const mine = Math.min(run.rights, spread.length - 1);
  return h(
    "section",
    { class: "sect bulgaria-today" },
    h(
      "div",
      { class: "sect-head" },
      h("h2", null, "България днес"),
      h("span", { class: "sect-note" }, `${formatNumber(t.board.players)} играха`),
    ),
    h(
      "div",
      {
        class: "spread-chart",
        role: "img",
        "aria-label": `Колко играчи на колко верни: най-много на ${spread.indexOf(Math.max(...spread))}. Ти: ${run.rights}.`,
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
              h("span", null, `средно ${formatNumber(avg, 0.1)}`),
            )
          : null,
      ),
      h(
        "div",
        { class: "spread-ticks", "aria-hidden": "true" },
        spread.map((_, i) => h("span", { class: i === mine ? "me" : undefined }, String(i))),
      ),
    ),
    h(
      "div",
      { class: "figures-row bulgaria-figures" },
      h(
        "div",
        { class: "fig" },
        h("b", { class: "fig-n" }, formatNumber(avg, 0.1)),
        h("span", { class: "fig-label" }, `средно от ${t.board.of}`),
      ),
      h(
        "div",
        { class: "fig" },
        h("b", { class: "fig-n" }, formatNumber(spread.at(-1) ?? 0)),
        h("span", { class: "fig-label" }, "с всички верни"),
      ),
      () => {
        const x = hardest();
        return x
          ? h(
              "div",
              { class: "fig" },
              h("b", { class: "fig-n" }, percent(x.share)),
              h("span", { class: "fig-label" }, `знаят въпрос ${x.n + 1}, най-трудния днес`),
            )
          : null;
      },
    ),
  );
}

/** An entry the day's right answers wrote, as the book has it now: with a crowd, the rarest („Най-рядкото ти
 * попадение“, its chapter and how few knew it); without one, the hardest („Днес в Алманаха ти“, its chapter and its
 * place in the ten), nothing said of others. The answer as a headword, the question in italic, the fact with a drop
 * cap, and the chapter it's written into. A right answer's: it's in the book. */
function entryOfDay(r?: DayEntry | null): Child {
  if (!r) return null;
  const f = r.fact;
  const chapter = topics.find((c) => c.id === f.category)?.name ?? "";
  const kicker = !r.crowd ? `въпрос ${r.n + 1}` : r.right ? `знаят го ${percent(r.right)}` : "само ти го знаеш";
  return h(
    "section",
    { class: `sect rarest t-${f.category}` },
    h("div", { class: "sect-head" }, h("h2", null, r.crowd ? "Най-рядкото ти попадение" : "Днес в Алманаха ти")),
    h("p", { class: "kicker rarest-kicker" }, `${chapter} · ${kicker}`),
    h(
      "div",
      { class: "entry first rarest-entry" },
      h("p", { class: "entry-word" }, f.untrue ? h("span", { class: "entry-untrue" }, "Невярно: ") : null, f.answer),
      f.question ? h("p", { class: "entry-q" }, f.question) : null,
      h("p", { class: "entry-fact" }, f.fact),
      h(
        "p",
        { class: "filed" },
        picture(`topic-${f.category}`, `filed-pic t-${f.category}`),
        `Записано в Алманаха, глава „${chapter}“`,
      ),
    ),
  );
}

/** „Сподели резултата“: the sheet with the day's card and its text (game/share.ts), „Сподели“ (the device's share
 * sheet, where there is one) and „Копирай текста“. */
function shareButton(run: State, t: Today): Child {
  const open = () => shareSheet(run, t);
  return h("button", { class: "btn primary result-share-go", type: "button", onclick: open }, "Сподели резултата");
}

/** The share sheet over the result (a <dialog>, from the foot on a phone, centred on a big screen): the card a link's
 * preview shows (internal/card), the text the link goes with, and the ways to send it. Esc, „Затвори“ or a tap beside
 * it puts it away. */
function shareSheet(run: State, t: Today): void {
  const text = signal("");
  const said = signal("");
  const shape = run.trail
    .filter((m) => !m.void)
    .map((m) => (m.right ? "1" : "0"))
    .join("");
  const sheet = h("dialog", { class: "sheet share-sheet", "aria-labelledby": "share-title" }) as HTMLDialogElement;
  const close = () => {
    sheet.close();
    sheet.remove();
  };
  shareText(run.id).then(text.set, (err) => said.set(errorText(err)));
  const send = async () => {
    said.set("");
    try {
      const out = await shareDay(run.id);
      if (out === "copied") said.set("Копирано.");
      else if (typeof out === "object") said.set("Копирай текста по-горе.");
      else if (out === "shared") close();
    } catch (err) {
      said.set(errorText(err));
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text.peek() || (await shareText(run.id)));
      said.set("Копирано.");
    } catch {
      said.set("Копирай текста по-горе.");
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
      h("p", { class: "kicker" }, "Картата към връзката"),
      h("img", {
        class: "share-card",
        src: `/card/${t.issue ?? issueOf(t.day)}-${shape}.png`,
        alt: `Брой ${t.issue ?? issueOf(t.day)}: ${run.rights} от ${outOf(run)}`,
        width: 1200,
        height: 630,
      }),
      h("p", { class: "kicker" }, "Текстът"),
      h("pre", { class: "share-text" }, () => text() || "…"),
      h(
        "div",
        { class: "share-ways" },
        canShare ? h("button", { class: "btn primary", type: "button", onclick: send }, "Сподели") : null,
        h("button", { class: canShare ? "btn" : "btn primary", type: "button", onclick: copy }, "Копирай текста"),
      ),
      () => (said() ? h("p", { class: "share-said", role: "status" }, said()) : null),
      h("p", { class: "small share-note" }, "Отговорите не се виждат. Който отвори връзката, играе същия брой."),
    ),
  );
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) close();
  });
  sheet.addEventListener("close", () => sheet.remove());
  document.body.append(sheet);
  sheet.showModal();
}

/** Tomorrow: the next issue's date set large, when it comes and what it makes of the streak (`streak`: with today's);
 * a guest's ask to keep the game (keep.ts: what it risks till then, `stake`); and, where it isn't on yet, the
 * reminder's ask (`ask`; null where the result's action is the ask, or the way out of an app's browser). */
function tomorrow(
  t: Today,
  streak: () => number,
  stake: () => string | null,
  ask: { view: Child; mailing: () => boolean } | null,
): Child {
  const next = new Date(`${t.day}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const day = next.toISOString().slice(0, 10);
  const left = signal(untilMidnight());
  const every = setInterval(() => left.set(untilMidnight()), 30_000);
  onCleanup(() => clearInterval(every));
  return h(
    "section",
    { class: "sect tomorrow" },
    h("div", { class: "sect-head" }, h("h2", null, "Утре")),
    h(
      "div",
      { class: "tomorrow-row" },
      h("b", { class: "tomorrow-n" }, day.slice(8).replace(/^0/, "")),
      h("p", { class: "tomorrow-words" }, h("b", null, `Брой ${issueOf(day)}, ${weekday(day).toLowerCase()}.`), () => {
        const n = streak();
        return ` Излиза след ${left()}${n > 0 ? ` Серията ти става ${n + 1}.` : ""}`;
      }),
    ),
    // The ask by mail asks a guest for the email itself: the line to keep the game steps aside for it.
    ask ? [keepLine(stake, ask.mailing), ask.view] : null,
  );
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
  // An ended streak's number is never said (DECISIONS.md, „The direction“): only that a new one begins.
  const text = t.forgiven
    ? `${onDay(t.forgiven).replace(/^./, (c) => c.toUpperCase())} пропусна въпросите, но серията остава. ${forgivesWords(t.perWeek)} Серия: ${count(t.streak, "ден", "дни")}.`
    : t.ended
      ? `Серията ти прекъсна. ${begins}.`
      : `Радваме се, че се върна. ${begins} серия.`;
  return h("p", { class: "streak-notice", role: "status" }, text);
}

/** What the streak forgives a week, in words: „Ако пропуснеш ден, до два на седмица ти се прощават.“ */
const forgivesWords = (perWeek = 2) =>
  perWeek === 1
    ? "Ако пропуснеш ден, един на седмица ти се прощава."
    : "Ако пропуснеш ден, до два на седмица ти се прощават.";

/** The streak's words beside its number. */
const streakLabel = (n: number) => (n === 1 ? "ден поред" : "дни поред");

/** The streak just grown by the day played (`was` before it, `now` after), moved there in its chip once the result
 * has landed (`after`): its number rolls on. Resolves once it's over. Without the game's feel loaded, or with less
 * motion, it is simply as it is. */
async function grow(chip: HTMLElement, was: Today, now: Today, after: Promise<void>): Promise<void> {
  const kit = feelKit();
  if (!kit || now.streak !== was.streak + 1) return;
  // Unlit as it was before the day, until its number rolls on.
  chip.classList.add("unlit");
  after.then(() => chip.classList.remove("unlit"));
  await kit.streak(chip, now.streak, streakLabel, after, hands());
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The logo's rosette as a seal over ten of ten: four petals, the gold one last (feel.ts draws them in). */
function seal(): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("class", "seal");
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
 * already; never in an app's own browser, where the way out to the phone's leads (keep.ts, exitWay). At most three times,
 * and never twice in a day. `mailing`: the ask by mail is asking a guest for an email, or was told „Не сега“ today
 * (one „Не сега“ is enough for the email asked for both ways). */
function remindAsk(
  day: string,
  stake: () => string | null,
): { view: Child; mailing: () => boolean; showing: () => boolean } {
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
  const showing = () => state() !== "gone";
  if (asked.n >= 3 || asked.day === day || !by.peek()) return { view: null, mailing, showing };
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
  return { view, mailing, showing };
}
