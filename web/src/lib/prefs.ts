// What the player has set for this device: less motion, bigger text, whether the clock ticks, Роял's music, and (in the
// app) the phone's touch. Kept in the browser (like the sounds' switch), and put on the page as classes on <html>,
// which the CSS reads.

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
/** Bigger text, everywhere. */
export const bigText = signal(read("almanac.big", false));
/** The clock's last seconds of a question (the other sounds have their own switch). */
export const tickOn = signal(read("almanac.tick", true));

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
  root.classList.toggle("big-text", bigText.peek());
}

export function setCalm(on: boolean): void {
  calm.set(on);
  keep("almanac.calm", on);
  apply();
}

export function setBigText(on: boolean): void {
  bigText.set(on);
  keep("almanac.big", on);
  apply();
}

export function setTick(on: boolean): void {
  tickOn.set(on);
  keep("almanac.tick", on);
}

/** Puts the player's settings on the page; called once at the start. */
export function applyPrefs(): void {
  apply();
}
