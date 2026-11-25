// What the player has set for this device: Night or Day, and whether the clock ticks, kept in the browser (like the
// sounds' switch); Night or Day goes on the page as `data-scheme` on <html>, which the CSS reads. Less motion and the
// text's size are the device's own settings, never the game's: the page follows them (calm, measure).

import { signal } from "./dom.ts";

function read(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "on";
  } catch {
    return fallback; // storage refused (a private window): the default, for this visit
  }
}

function keep(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    // Not kept: the choice holds for this visit.
  }
}

const calmQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

/** Less motion: no animations or transitions but the timer's. The device's own setting, and only it: the game asks
 * nothing of its own (Настройки had a switch nobody used). The script's movements ask it here; the style's, by the
 * same media query (app.css, at its end). */
export const calm = signal(!!calmQuery?.matches);
calmQuery?.addEventListener("change", (e) => calm.set(e.matches));
/** The clock's last seconds of a question (the other sounds have their own switch). */
export const tickOn = signal(read("almanac.tick", true));

/** How the game looks on this device: as the device is set (Night or Day by its own setting), or Night or Day
 * whatever it's set to (a big screen in a lit room reads better by Day). On the page as `data-scheme` on <html>
 * (app.css); none for the device's. */
export type Scheme = "device" | "night" | "day";

function readScheme(): Scheme {
  try {
    const v = localStorage.getItem("almanac.scheme");
    return v === "night" || v === "day" ? v : "device";
  } catch {
    return "device";
  }
}

export const scheme = signal<Scheme>(readScheme());

/** The browser's own bar (a phone's, over the page), in the page's colour: app.css's --bg by Day and by Night (server: TestBrowserBarIsThePage). */
const barColour = { night: "#0e0c1d", day: "#f3f4fa" };

function apply(): void {
  const root = document.documentElement;
  const chosen = scheme.peek();
  if (chosen === "device") root.removeAttribute("data-scheme");
  else root.dataset.scheme = chosen;
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    m.content = chosen === "device" ? barColour[m.media.includes("light") ? "day" : "night"] : barColour[chosen];
  }
  measure();
}

export function setScheme(v: Scheme): void {
  scheme.set(v);
  try {
    if (v === "device") localStorage.removeItem("almanac.scheme");
    else localStorage.setItem("almanac.scheme", v);
  } catch {
    // Not kept: the choice holds for this visit.
  }
  apply();
}

/** How wide the page's column is in the text's own size (em): with large text on a phone, few words to a line. Under
 * 17 (none at the usual size, the narrowest phone's column is 18), rows that need more room give way to columns
 * (`tight` on <html>: app.css, Large text); under 13.5, the bar of places shows its pictures alone (`tighter`). Measured
 * here rather than asked by a container query in rem, which Chromium doesn't always ask again as the text's size
 * changes. Again as the column's width changes (a phone turned, a window resized) and as the text's size does. */
export function measure(): void {
  // The screen's column (app.ts: the frame's <main>), or the page before the frame is drawn.
  const app = document.getElementById("main") ?? document.getElementById("app");
  if (!app) return;
  const root = document.documentElement;
  const box = getComputedStyle(app);
  const width = app.clientWidth - Number.parseFloat(box.paddingLeft) - Number.parseFloat(box.paddingRight);
  const em = width / Number.parseFloat(getComputedStyle(root).fontSize);
  if (!(em > 0)) return; // not laid out (a page hidden at its start): as it was
  root.classList.toggle("tight", em < 17);
  root.classList.toggle("tighter", em < 13.5);
}

export function setTick(on: boolean): void {
  tickOn.set(on);
  keep("almanac.tick", on);
}

/** Puts the player's settings on the page; called once at the start. */
export function applyPrefs(): void {
  apply();
  const app = document.getElementById("app");
  if (app && typeof ResizeObserver === "function") new ResizeObserver(measure).observe(app);
}
