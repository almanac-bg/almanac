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
    about: "Всяка вечер в 21:00",
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
  };
  /** How many said they'd come to the next one, and whether the player did. */
  coming: number;
  planned: boolean;
}

/** Who said they'd come to the next Роял, in words: „Тази вечер ще дойдат 14“ (or „Утре вечер …“ once tonight's is
 * over). */
export function coming(t: Tonight): string {
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Europe/Sofia" });
  const when = day(t.glance.next) === day(t.glance.now) ? "Тази вечер" : "Утре вечер";
  return `${when} ${t.coming === 1 ? "ще дойде 1" : `ще дойдат ${t.coming}`}`;
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
    return all.royal.about;
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
