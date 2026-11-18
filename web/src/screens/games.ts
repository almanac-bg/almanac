// Всички игри (/games): every game a player has finished, newest first, by day under its dateline, each a way to go over
// it (/games/<id>); the day's ten, games of topics or games with others alone, by a switch; a page at a time („Още
// игри“). From Профил, under its latest five.

import type { Kit } from "../kit.ts";
import type { Played } from "./stats.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let { loading, api, h, signal, title, back, segmented, rename, failure, gameRow } = {} as Kit;

type Kind = "" | "day" | "topic" | "others";

const kinds: [Kind, string][] = [
  ["", "Всички"],
  ["day", "Броеве"],
  ["topic", "Теми"],
  ["others", "С други"],
];

/** A page of games, as /api/me/games has it. */
interface Page {
  games: Played[];
  next?: string;
}

/** The day a game ended on, in Bulgaria (YYYY-MM-DD), and as its dateline says it. */
const dayOf = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date(ms));
const dateline = (ms: number) =>
  new Intl.DateTimeFormat("bg", {
    timeZone: "Europe/Sofia",
    day: "numeric",
    month: "long",
    year: dayOf(ms).slice(0, 4) === dayOf(Date.now()).slice(0, 4) ? undefined : "numeric",
  }).format(new Date(ms));

export function games(kit: Kit) {
  ({ loading, api, h, signal, title, back, segmented, rename, failure, gameRow } = kit);
  title("Всички игри");
  const kind = signal<Kind>(kinds.find(([k]) => k && `#${k}` === location.hash)?.[0] ?? "");
  const list = signal<Played[] | null>(null);
  const next = signal<string | undefined>(undefined);
  const error = signal<unknown>(null);
  const asking = signal(false);
  // The list asked for now: an answer to an older one arriving late is dropped.
  let asked = 0;
  const more = async (fresh: boolean) => {
    const mine = fresh ? ++asked : asked;
    const q = new URLSearchParams();
    if (kind.peek()) q.set("kind", kind.peek());
    if (!fresh && next.peek()) q.set("from", next.peek() ?? "");
    asking.set(true);
    error.set(null);
    try {
      const page = await api<Page>("GET", `/api/me/games?${q}`);
      if (mine !== asked) return;
      list.set(fresh ? page.games : [...(list.peek() ?? []), ...page.games]);
      next.set(page.next);
    } catch (err) {
      if (mine === asked) error.set(err);
    } finally {
      if (mine === asked) asking.set(false);
    }
  };
  more(true);
  const pick = (k: Kind) => {
    if (kind.peek() === k) return;
    kind.set(k);
    rename(location.pathname + (k ? `#${k}` : ""));
    list.set(null);
    next.set(undefined);
    more(true);
  };
  return h(
    "section",
    { class: "screen stack" },
    back("/me", "Профил"),
    h("h1", null, "Всички игри"),
    segmented("Кои игри", kinds, kind, pick),
    // Among the issues, the way to those gone by (screens/issues.ts).
    () => (kind() === "day" ? h("p", { class: "day-next" }, h("a", { href: "/issues" }, "Минали броеве")) : null),
    () => {
      const all = list();
      if (!all) return error() ? failure(error(), () => more(true)) : loading("rows");
      if (!all.length) return h("p", { class: "muted" }, "Още няма такива игри.");
      // By day, newest first: each day's games under its dateline.
      const days: { day: string; at: number; games: Played[] }[] = [];
      for (const p of all) {
        const day = dayOf(p.at);
        const last = days[days.length - 1];
        if (last?.day === day) last.games.push(p);
        else days.push({ day, at: p.at, games: [p] });
      }
      return h(
        "div",
        { class: "games-days" },
        days.map((d) =>
          h(
            "section",
            { class: "games-day" },
            h("h2", { class: "kicker almanac-date" }, h("time", { datetime: d.day }, dateline(d.at))),
            h(
              "ol",
              { class: "games" },
              d.games.map((p) => gameRow(p, null)),
            ),
          ),
        ),
      );
    },
    () =>
      list() && next()
        ? h("button", { class: "btn", type: "button", disabled: asking(), onclick: () => more(false) }, "Още игри")
        : null,
    () => (list() && error() ? h("p", { class: "bad", role: "alert" }, "Не успяхме. Опитай пак.") : null),
  );
}
