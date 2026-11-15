// The ways to play with others, as small cards two by two: each with its picture, its name, a few words about it, and
// its colour. Роял's card follows the evening: how many said they'd come, and from the lobby's opening, how soon it
// starts and how many are in.

import { picture } from "../art/picture.ts";
import { api } from "../lib/api.ts";
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
    about: "На живо в 21:00",
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
  /** How many said they'd come to the next one, and whether the player did. */
  coming: number;
  planned: boolean;
}

export const clock = (ms: number) =>
  new Intl.DateTimeFormat("bg", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Sofia" }).format(new Date(ms));
export const dayOf = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Europe/Sofia" });

/** The day of ms from now's, in words: „днес“, „утре“, or its weekday („в петък“, „във вторник“). */
function onDay(ms: number, now: number): string {
  const day = dayOf(ms);
  if (day === dayOf(now)) return "днес";
  if (day === dayOf(now + 24 * 3600_000)) return "утре";
  const weekday = new Intl.DateTimeFormat("bg", { weekday: "long", timeZone: "Europe/Sofia" }).format(new Date(ms));
  return `${/^[вф]/.test(weekday) ? "във" : "в"} ${weekday}`;
}

/** When an evening is, in words: „днес в 21:00“, „утре в 21:00“, „в петък в 21:00“. */
export const when = (ms: number, now: number) => `${onDay(ms, now)} в ${clock(ms)}`;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Who said they'd come to the next Роял, in words: „Тази вечер ще дойдат 14“ (or „Утре вечер …“, „В петък …“). */
export function coming(t: Tonight): string {
  const day = onDay(t.glance.next, t.glance.now);
  const at = day === "днес" ? "Тази вечер" : day === "утре" ? "Утре вечер" : cap(day);
  return `${at} ${t.coming === 1 ? "ще дойде 1" : `ще дойдат ${t.coming}`}`;
}

/** What Роял's card says now: the evening's live state, or how many are coming, or when it is. */
function royalNow(): () => string {
  const tonight = signal<Tonight | null>(null);
  const now = signal(Date.now());
  let skew = 0;
  const load = () =>
    api<Tonight>("GET", "/api/royal/tonight").then(
      (t) => {
        skew = t.glance.now - Date.now();
        now.set(t.glance.now);
        tonight.set(t);
      },
      () => {},
    );
  load();
  const tick = setInterval(() => now.set(Date.now() + skew), 15_000);
  const again = setInterval(load, 60_000);
  onCleanup(() => {
    clearInterval(tick);
    clearInterval(again);
  });
  return () => {
    const t = tonight();
    if (!t) return all.royal.about;
    const g = t.glance;
    if (g.phase === "lobby") {
      const min = Math.max(1, Math.ceil((g.startsAt - now()) / 60_000));
      // No breaks inside „12 мин“: the card is narrow.
      return `Започва след ${min}\u00a0мин${g.in ? ` · ${g.in}\u00a0вътре` : ""}`;
    }
    if (g.phase === "live") return `Играе се · ${g.in}\u00a0още вътре`;
    if (t.coming > 0) return coming(t);
    return g.nightly ? "Всяка вечер в 21:00" : cap(when(g.next, now()));
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
              h("span", { class: "mode-about" }, m === "royal" ? royalNow() : it.about),
            ),
          ),
        );
      }),
    ),
  );
}
