// Минали броеве (play/past.go): every past day's ten, newest first, each played once by whoever didn't finish them on
// their day (/issues), and one of them (/issues/<n>) played as the day's players played it, then told against them
// („По-добре от 64% от играчите на този брой“). A past issue is outside the streak, the league and the day's goals,
// and says so. It's also how a broken streak is won back: the missed issue and today's (screens/today.ts, repairCard).
// Opened from Начало's tile, from „Още десет“ after the day, from Всички игри and from Моят Алманах's datelines.

import type { State } from "../game/types.ts";
import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  loading,
  api,
  h,
  signal,
  title,
  back,
  failure,
  runGame,
  summary,
  news,
  formatNumber,
  dateWords,
  weekday,
  ApiError,
} = {} as Kit;

/** A past issue, as /api/issues lists it: the player's game of it, of the day itself or since. */
interface Issue {
  day: string;
  issue: number;
  players: number;
  mine?: { id: number; kind: "day" | "past"; rights: number; total: number; at: number; done: boolean };
}

/** How a game of a past issue went against that day's players (play.PastStanding). */
interface Standing {
  players: number;
  average?: number;
  better: number;
}

/** What every past issue is, said where one is played. */
export const pastLine = "Минал брой: не влиза в серията и в лигата.";

/** From how many of the day's players a share of them is worth saying (as the day's own: game/standing.ts). */
const shareFrom = 10;

export function issues(kit: Kit) {
  ({
    loading,
    api,
    h,
    signal,
    title,
    back,
    failure,
    runGame,
    summary,
    news,
    formatNumber,
    dateWords,
    weekday,
    ApiError,
  } = kit);
  title("Минали броеве");
  const list = signal<Issue[] | null>(null);
  const error = signal<unknown>(null);
  const load = () =>
    api<{ issues: Issue[] }>("GET", "/api/issues").then(
      (r) => list.set(r.issues),
      (err) => error.set(err),
    );
  load();
  return h(
    "section",
    { class: "screen stack" },
    back("/", "Начало"),
    h(
      "div",
      { class: "intro" },
      h("h1", null, "Минали броеве"),
      h("p", { class: "lead" }, "Десетте въпроса на всеки минал ден, същите, които тогава игра всеки. Веднъж всеки."),
      h("p", { class: "muted" }, pastLine),
    ),
    () => {
      const all = list();
      if (!all) return error() ? failure(error(), load) : loading("rows");
      if (!all.length) return h("p", { class: "muted" }, "Още няма минали броеве. Първият излиза утре.");
      return h(
        "ol",
        { class: "games issues-list" },
        all.map((i) => h("li", null, row(i))),
      );
    },
  );
}

/** A past issue in the list: its number and date, and the player's game of it — its score (a way to go over it), where
 * it was left, or the way to play it. */
function row(i: Issue): Child {
  const m = i.mine;
  const href = m?.kind === "day" ? `/games/${m.id}` : `/issues/${i.issue}`;
  return h(
    "a",
    { class: "game", href },
    h(
      "div",
      { class: "game-text" },
      h("strong", { class: "game-what" }, `Брой ${i.issue}`),
      h(
        "span",
        { class: "game-when" },
        `${weekday(i.day)}, ${dateWords(i.day)}${m?.kind === "day" ? " · в деня му" : ""}`,
      ),
    ),
    m?.done
      ? h("b", { class: "game-score" }, String(m.rights), h("span", { class: "num-word" }, " от "), String(m.total))
      : h("span", { class: "issue-go" }, m ? `Продължи · въпрос ${m.at + 1}` : "Изиграй"),
  );
}

/** One past issue (/issues/<n>): its game, started after the count or gone on with where it was left; at its end, how
 * it went against the issue's players. One played on its day, today's, or one not out yet, says so instead. */
export function issue(kit: Kit, [n = ""]: string[]) {
  ({
    loading,
    api,
    h,
    signal,
    title,
    back,
    failure,
    runGame,
    summary,
    news,
    formatNumber,
    dateWords,
    weekday,
    ApiError,
  } = kit);
  const number = Number(n);
  const name = `Брой ${number}`;
  title(name);
  const finished = (s: State, just: boolean): Child => {
    const standing = signal<Standing | null>(null);
    const next = signal<{ run: State | null; past?: { day: string; issue: number } | null } | null>(null);
    api<{ standing?: Standing }>("GET", `/api/issues/${number}`).then(
      (r) => standing.set(r.standing ?? null),
      () => {},
    );
    api<{ run: State | null; past?: { day: string; issue: number } | null }>("GET", "/api/day").then(
      next.set,
      () => {},
    );
    return h(
      "div",
      { class: "screen" },
      summary(
        s,
        [
          h("div", { class: "day-line" }, h("span", { class: "kicker" }, `${name} · ${dateWords(s.day ?? "")}`)),
          h("p", { class: "muted past-line" }, pastLine),
          () => against(standing()),
        ],
        {
          // What's next: the day's ten while they wait, else the newest issue not played, else Начало.
          main: () => {
            const d = next();
            if (!d) return null;
            if (!d.run?.done) return h("a", { class: "btn primary big", href: "/" }, "Към въпросите на деня");
            if (d.past)
              return h("a", { class: "btn primary big", href: `/issues/${d.past.issue}` }, `Брой ${d.past.issue}`);
            return h("a", { class: "btn primary big", href: "/" }, "Към Начало");
          },
          also: [h("a", { class: "btn", href: "/issues" }, "Минали броеве")],
        },
        just ? [news(s.id)] : [],
        undefined,
        just,
      ),
    );
  };
  return h(
    "div",
    null,
    runGame({
      name,
      lead: "Десетте въпроса на деня, както ги игра всеки тогава.",
      begin: () => api<State>("POST", `/api/issues/${number}`, {}),
      left: (l) => l.kind === "past" && l.issue === number,
      finished: (s, _again, just) => finished(s, just),
      closed: async () => {
        try {
          const r = await api<{ issue: Issue }>("GET", `/api/issues/${number}`);
          const m = r.issue.mine;
          if (m?.kind === "day") return playedOnTheDay(r.issue);
          if (m?.done) return finished(await api<State>("GET", `/api/runs/${m.id}`), false);
          return null;
        } catch (err) {
          if (err instanceof ApiError && err.code === "no_issue") return notOut(number);
          return failure(err, () => location.reload(), ["/issues", "Минали броеве"]);
        }
      },
    }),
  );
}

/** How the game went against the issue's players: the share of them it did better than, from ten of them, and how many
 * right they had on average. */
function against(s: Standing | null): Child {
  if (!s?.players) return null;
  const lines = [
    s.players >= shareFrom && s.better > 0
      ? h("p", { class: "crowd-says" }, `По-добре от ${s.better}% от играчите на този брой.`)
      : null,
    s.average !== undefined
      ? h("p", { class: "crowd-says" }, `Средно на този брой: ${formatNumber(s.average, 0.1)} от 10.`)
      : null,
  ].filter(Boolean);
  return lines.length ? h("div", null, lines) : null;
}

/** An issue the player finished on its day: it's that game, gone over on its own page. */
function playedOnTheDay(i: Issue): Child {
  const m = i.mine;
  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "intro" },
      h("h1", null, `Брой ${i.issue}`),
      h("p", { class: "lead" }, `Изигра го в деня му, ${dateWords(i.day)}: ${m?.rights} от ${m?.total}.`),
    ),
    h("a", { class: "btn primary", href: `/games/${m?.id}` }, "Прегледай въпросите"),
    h("a", { class: "btn", href: "/issues" }, "Минали броеве"),
  );
}

/** A number that isn't a past issue yet: today's (its way is Начало), or one still to come. */
function notOut(n: number): Child {
  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "intro" },
      h("h1", null, `Брой ${n}`),
      h(
        "p",
        { class: "lead" },
        "Този брой още не е минал. Минал брой се играе от малко след полунощ на следващия ден.",
      ),
    ),
    h("a", { class: "btn primary", href: "/" }, "Към въпросите на деня"),
    h("a", { class: "btn", href: "/issues" }, "Минали броеве"),
  );
}
