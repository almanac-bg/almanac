// The ways to play with others, as small cards two by two: each with its picture, its name, a few words about it, and
// its colour. Роял's card says what it is (a tournament, live: the name alone doesn't), and follows the evening: how
// many said they'd come, and from the lobby's opening, how soon it starts and how many are in.

import { picture } from "../art/picture.ts";
import { fresh, last } from "../lib/api.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";

type Mode = "duel" | "royal" | "room";

const all: Record<Mode, { href: string; name: string; about: string; tone: string }> = {
  duel: {
    href: "/duel",
    name: "Дуел",
    about: "Един срещу един",
    tone: "tone-rose",
  },
  royal: {
    href: "/royal",
    name: "Роял",
    about: "В 21:00",
    tone: "tone-gold",
  },
  room: { href: "/room", name: "Стая", about: "С код, за своите хора", tone: "tone-lilac" },
};

/** The next Роял at a glance (GET /api/royal/tonight). */
export interface Tonight {
  glance: {
    /** "soon": the lobby isn't open; "lobby": it is; "live": the games are under way. */
    phase: "soon" | "lobby" | "live";
    startsAt: number;
    opensAt: number;
    /** The server's clock. */
    now: number;
    next: number;
    /** In the lobby, or still in the games. */
    in: number;
    /** Every evening (else Friday to Sunday). */
    nightly?: boolean;
  };
  /** How many said they'd come to the next one, whether the player did, and which of their friends did. */
  coming: number;
  planned: boolean;
  friends?: string[];
}

export const clock = (ms: number) =>
  new Intl.DateTimeFormat("bg", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Sofia" }).format(new Date(ms));
export const dayOf = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Europe/Sofia" });

/** The day of ms from now's, in words: „днес“, „утре“, or its weekday („в петък“, „във вторник“). */
export function dayWord(ms: number, now: number): string {
  const day = dayOf(ms);
  if (day === dayOf(now)) return "днес";
  if (day === dayOf(now + 24 * 3600_000)) return "утре";
  const weekday = new Intl.DateTimeFormat("bg", { weekday: "long", timeZone: "Europe/Sofia" }).format(new Date(ms));
  return `${/^[вф]/.test(weekday) ? "във" : "в"} ${weekday}`;
}

/** When an evening is, in words: „днес в 21:00“, „утре в 21:00“, „в петък в 21:00“. */
export const dayAndTime = (ms: number, now: number) => `${dayWord(ms, now)} в ${clock(ms)}`;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Runs load again every ms while the page is in view, and at once as it comes back into view (a tab again, a phone
 * woken): never while nobody looks. Until the screen goes. */
export function whileSeen(load: () => void, ms: number): void {
  const look = () => {
    if (!document.hidden) load();
  };
  const every = setInterval(look, ms);
  document.addEventListener("visibilitychange", look);
  onCleanup(() => {
    clearInterval(every);
    document.removeEventListener("visibilitychange", look);
  });
}

/** Who said they'd come to the next Роял, in words: „Тази вечер ще дойдат 14“ (or „Утре вечер …“, „В петък …“), a
 * friend first if one did: „Мария и още 4 ще дойдат тази вечер“. */
export function coming(t: Tonight): string {
  const day = dayWord(t.glance.next, t.glance.now);
  const at = day === "днес" ? "тази вечер" : day === "утре" ? "утре вечер" : day;
  const [friend] = t.friends ?? [];
  const more = t.coming - 1 - (t.planned ? 1 : 0);
  if (friend) return `${friend}${more > 0 ? ` и още ${more} ще дойдат` : " ще дойде"} ${at}`;
  return `${cap(at)} ${t.coming === 1 ? "ще дойде 1" : `ще дойдат ${t.coming}`}`;
}

/** What Роял's card says now: the evening's live state, or how many are coming, or when it is. */
function royalNow(): () => string {
  // What it said last, at once (lib/api.ts, last): Начало opened again doesn't wait for it.
  const tonight = signal<Tonight | null>(last<Tonight>("/api/royal/tonight") ?? null);
  const now = signal(Date.now());
  let skew = 0;
  const load = () =>
    fresh<Tonight>("/api/royal/tonight").then(
      (t) => {
        skew = t.glance.now - Date.now();
        now.set(t.glance.now);
        tonight.set(t);
      },
      () => {},
    );
  load();
  whileSeen(load, 60_000);
  const tick = setInterval(() => now.set(Date.now() + skew), 15_000);
  onCleanup(() => clearInterval(tick));
  return () => {
    const t = tonight();
    if (!t) return all.royal.about;
    const g = t.glance;
    if (g.phase === "lobby") {
      // Past the start, still in the lobby: too few came, and it waits for more.
      if (g.startsAt <= now()) return `Чака още играчи${g.in ? ` · ${g.in}\u00a0вътре` : ""}`;
      const min = Math.max(1, Math.ceil((g.startsAt - now()) / 60_000));
      // No breaks inside „12 мин“: the card is narrow.
      return `Започва след ${min}\u00a0мин${g.in ? ` · ${g.in}\u00a0вътре` : ""}`;
    }
    if (g.phase === "live") return `Играе се · още ${g.in}\u00a0в играта`;
    if (t.coming > 0) return coming(t);
    return g.nightly ? "Всяка вечер в 21:00" : cap(dayAndTime(g.next, now()));
  };
}

export function modes(which: Mode[], heading?: string): Child {
  return h(
    "section",
    { class: "stack" },
    heading ? h("h2", { class: "section-title" }, heading) : null,
    h(
      "ul",
      { class: "modes" },
      which.map((m) => {
        const it = all[m];
        return h(
          "li",
          null,
          h(
            "a",
            { class: `mode ${it.tone}`, href: it.href },
            picture(`mode-${m}`, "mode-pic"),
            h(
              "span",
              { class: "mode-text" },
              h("span", { class: "mode-name" }, it.name),
              m === "royal" ? h("span", { class: "mode-kind" }, "Турнир на живо") : null,
              h("span", { class: "mode-about" }, m === "royal" ? royalNow() : it.about),
            ),
          ),
        );
      }),
    ),
  );
}
