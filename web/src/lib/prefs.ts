// What the player has set for this device: less motion, the text's size, whether the clock ticks, Роял's music, and (in
// the app) the phone's touch. Kept in the browser (like the sounds' switch), and put on the page: less motion as a
// class on <html>, which the CSS reads, the text's size as <html>'s own (everything is sized from it, in rem).

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

/** The phone's own text size as a share of its usual, in the app on an iPhone, whose web view doesn't follow it by
 * itself (app.ts); 1 everywhere else, where the browser does what it does with it. */
let systemText = 1;

export function setSystemText(scale: number): void {
  systemText = scale;
  apply();
}

/** The page's text as a share of the browser's: the player's step times the phone's own size, at most twice the
 * usual, which every screen is made to hold (app.css, e2e/text.spec.ts); past that, layouts give way. */
export function rootScale(size: TextSize, system: number): number {
  return Math.min(2, textScales[size] * system);
}

/** Роял's lobby music (feel.ts), with the sounds on. */
export const musicOn = signal(read("almanac.music", true));

export function setMusic(on: boolean): void {
  musicOn.set(on);
  keep("almanac.music", on);
}

/** The phone's touch on answers and rewards, in the app (the sounds have their own switch). */
export const vibrateOn = signal(read("almanac.vibrate", true));

export function setVibrate(on: boolean): void {
  vibrateOn.set(on);
  keep("almanac.vibrate", on);
}

function apply(): void {
  const root = document.documentElement;
  root.classList.toggle("calm", calm.peek());
  const scale = rootScale(textSize.peek(), systemText);
  root.style.fontSize = scale === 1 ? "" : `${Math.round(scale * 1000) / 10}%`;
  measure();
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
