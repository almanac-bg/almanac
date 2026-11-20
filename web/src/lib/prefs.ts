// What the player has set for this device: Night or Day, less motion, the text's size, whether the clock ticks. Kept
// in the browser (like the sounds' switch), and put on the page: Night or Day as `data-scheme` and less
// motion as a class on <html>, which the CSS reads, the text's size as <html>'s own (everything is sized from it, in
// rem).

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

const osCalm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Less motion: no animations or transitions but the timer's. Follows the device's own setting until changed. */
export const calm = signal(read("almanac.calm", osCalm));
/** The clock's last seconds of a question (the other sounds have their own switch). */
export const tickOn = signal(read("almanac.tick", true));

/** The text's size, everywhere: as it comes, or a step or two larger. */
export type TextSize = "normal" | "big" | "bigger";

/** Each size as a share of the text as it comes: the browser's (or, in the app, the phone's) size times this. */
export const textScales: Record<TextSize, number> = { normal: 1, big: 1.25, bigger: 1.5 };

function readTextSize(): TextSize {
  try {
    const v = localStorage.getItem("almanac.text");
    if (v === "big" || v === "bigger") return v;
    // The one step there was before („По-едър текст“), on: the first of the steps now.
    if (v === null && localStorage.getItem("almanac.big") === "on") return "big";
  } catch {
    // Storage refused: the text as it comes.
  }
  return "normal";
}

export const textSize = signal<TextSize>(readTextSize());

export function setTextSize(size: TextSize): void {
  textSize.set(size);
  try {
    localStorage.setItem("almanac.text", size);
    localStorage.removeItem("almanac.big");
  } catch {
    // Not kept: the choice holds for this visit.
  }
  apply();
}

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

/** The browser's own bar (a phone's, over the page), in the page's colour: --bg's, by Night and by Day. */
const barColour = { night: "#110c20", day: "#f5f3fa" };

function apply(): void {
  const root = document.documentElement;
  root.classList.toggle("calm", calm.peek());
  const chosen = scheme.peek();
  if (chosen === "device") root.removeAttribute("data-scheme");
  else root.dataset.scheme = chosen;
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    m.content = chosen === "device" ? barColour[m.media.includes("light") ? "day" : "night"] : barColour[chosen];
  }
  const scale = textScales[textSize.peek()];
  root.style.fontSize = scale === 1 ? "" : `${Math.round(scale * 1000) / 10}%`;
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
  const app = document.getElementById("app");
  if (!app) return;
  const root = document.documentElement;
  const box = getComputedStyle(app);
  const width = app.clientWidth - Number.parseFloat(box.paddingLeft) - Number.parseFloat(box.paddingRight);
  const em = width / Number.parseFloat(getComputedStyle(root).fontSize);
  if (!(em > 0)) return; // not laid out (a page hidden at its start): as it was
  root.classList.toggle("tight", em < 17);
  root.classList.toggle("tighter", em < 13.5);
}

export function setCalm(on: boolean): void {
  calm.set(on);
  keep("almanac.calm", on);
  apply();
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
