// Sounds: made in the browser (no files), for a game's moments — a pick, the count before a game and its start, the
// clock's last seconds, a right answer (every one the same: nothing counts a row of them), a wrong one or none,
// the end (won, lost, perfect or just over), the result's pips, a note in the book, and something new
// waiting. On unless the player turns them off (kept on this device).
//
// Browsers allow sound only once the player has touched the page, so the audio starts then. The bigger sounds (an
// end, a win, a note…) take turns: one asked for while another still sounds follows it, never on top. On
// a phone the sounds mix with whatever the player is listening to and keep quiet with the silent switch. The voices
// themselves are in the game's feel (../feel.ts): here are the switch, the audio and the turns.

import * as feel from "../feel.ts";
import { signal } from "./dom.ts";

export type SoundName =
  | "tap"
  | "key"
  | "count"
  | "go"
  | "tick"
  | "perfect"
  | "pip"
  | "dud"
  | "hurry"
  | "right"
  | "exact"
  | "partial"
  | "wrong"
  | "time"
  | "end"
  | "win"
  | "lose"
  | "ping";

/** The bigger sounds, which take turns rather than sound over each other. */
const inTurn = new Set<SoundName>(["end", "perfect", "win", "lose"]);
/** The longest a sound waits for its turn; later than that it's no longer news, and is left out. */
const longestWait = 2.5;

const offKey = "almanac.sound";

function readOn(): boolean {
  try {
    return localStorage.getItem(offKey) !== "off";
  } catch {
    return true; // storage refused (a private window): sounds on, for this visit
  }
}

/** Whether sounds play (the player's choice, on this device). */
export const soundOn = signal(readOn());

/** Turns sounds on or off, and remembers it on this device. */
export function setSound(on: boolean): void {
  soundOn.set(on);
  try {
    if (on) localStorage.removeItem(offKey);
    else localStorage.setItem(offKey, "off");
  } catch {
    // Not kept: the choice holds for this visit.
  }
  if (on) play("tap");
}

/** Whether this is an iPhone or iPad, where the sounds keep quiet with the silent switch (the player is told so). */
export const quietWhenSilent = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

let audio: AudioContext | null = null;
/** When (in the audio's time) the last of the sounds that take turns ends. */
let freeAt = 0;

function context(): AudioContext | null {
  if (audio) return audio;
  if (typeof AudioContext === "undefined") return null;
  // No audio session is set: a page whose only sound is this already gets the "ambient" one on an iPhone (mixing with
  // the player's music, quiet with the silent switch), and setting it by hand only risks the phone's quirks.
  try {
    audio = new AudioContext();
  } catch {
    return null;
  }
  return audio;
}

/** Whether the page is being touched (or typed into) right now: the moment browsers let the audio start. */
function touchedNow(): boolean {
  return navigator.userActivation?.isActive ?? false;
}

/** Starts the audio from inside a touch: resumes it and plays a moment of silence, which is what an iPhone needs to
 * let the sound out (a resume alone may leave it running but mute). */
function unlock(c: AudioContext): void {
  c.resume().catch(() => {});
  const silence = c.createBufferSource();
  silence.buffer = c.createBuffer(1, 1, c.sampleRate);
  silence.connect(c.destination);
  silence.start();
}

/** Starts the audio on the player's touches and keys, the only time browsers allow it. An iPhone counts a touch only as it ends (touchend, click), never as the finger goes down. A phone
 * may stop the audio again (a call, the game in the background), sometimes leaving it "running" but mute: so this keeps
 * listening, and as the game comes back to the screen it stops the audio and starts it again. */
export function prepareSound(): void {
  const start = () => {
    if (!soundOn.peek()) return;
    const c = context();
    if (c && c.state !== "running") unlock(c);
  };
  for (const event of ["touchend", "click", "keydown"])
    addEventListener(event, start, { capture: true, passive: true });
  // Making the audio takes a phone a long moment (a tenth of a second on a slow one): made as the finger goes down,
  // while it's still on the glass, so that the tap's own screen doesn't wait for it as the finger lifts. Started only
  // then (start), as an iPhone allows.
  const ready = () => {
    if (soundOn.peek()) context();
  };
  for (const event of ["touchstart", "pointerdown"])
    addEventListener(event, ready, { capture: true, passive: true, once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !audio || audio.state === "closed") return;
    const c = audio;
    c.suspend()
      .then(() => c.resume())
      .catch(() => {});
  });
}

/** Plays a sound, if sounds are on and the browser allows them (else nothing: never a backlog later). `lift` raises
 * it by that many steps of the scale (feel.ts). */
export function play(name: SoundName, lift = 0): void {
  voice(name, lift);
}

/** A sound (play's). */
export function voice(name: SoundName, lift = 0): void {
  if (!soundOn.peek()) return;
  // Before any touch nothing could sound: no audio is made for it (a page's news as it opens, a friend's duel waiting).
  if (!audio && !touchedNow()) return;
  const c = context();
  if (!c) return;
  if (c.state !== "running") {
    // Not started yet (the very first touch) or stopped by the phone: a sound asked for by a touch starts it.
    if (!touchedNow()) return;
    unlock(c);
  }
  let t0 = c.currentTime + 0.01;
  if (inTurn.has(name)) {
    if (freeAt - t0 > longestWait) return;
    t0 = Math.max(t0, freeAt);
    freeAt = t0 + feel.length(name) + 0.15;
  }
  feel.sound(c, name, lift, t0);
}

/** How an answer sounds: every right one the same, whatever came before it. */
export function playAnswer(kind: "exact" | "right" | "partial" | "wrong" | "time"): void {
  voice(kind);
}

/** The beeps before a game starts: one for each of its last three seconds. */
export function playCount(secondsLeft: number): void {
  if (secondsLeft >= 1 && secondsLeft <= 3) play("count");
}
