// Sounds: made in the browser (no files), for a game's moments — a pick, the other side answering, the count before a
// game and its start, the clock's last seconds, a right answer (higher with each one in a row), a wrong one or none,
// the end (won, lost, perfect or just over), the result's pips and the streak, a note in the book, and something new
// waiting. On unless the player turns them off (kept on this device).
//
// Browsers allow sound only once the player has touched the page, so the audio starts then. The bigger sounds (an
// end, a win, a note…) take turns: one asked for while another still sounds follows it, never on top. On
// a phone the sounds mix with whatever the player is listening to and keep quiet with the silent switch. The voices
// themselves are in the game's feel (../feel.ts), a file of its own that the first touch sends for: here are the
// switch, the audio and the turns.

import { signal } from "./dom.ts";

export type SoundName =
  | "tap"
  | "key"
  | "them"
  | "count"
  | "go"
  | "tick"
  | "perfect"
  | "pip"
  | "dud"
  | "streak"
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

type Feel = typeof import("../feel.ts");
let kit: Feel | null = null;
let loading: Promise<Feel> | null = null;

/** The game's feel (../feel.ts), loaded once, with the first touch: what's heard and seen only once the player plays.
 * A load that failed is tried again by the next touch. */
export function loadFeel(): Promise<Feel> {
  loading ??= import("../feel.ts").then(
    (m) => {
      kit = m;
      return m;
    },
    (err) => {
      loading = null;
      throw err;
    },
  );
  return loading;
}

/** The game's feel, if it's in: until then the game is whole, only plainer and quieter. */
export const feelKit = (): Feel | null => kit;

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

/** Starts the audio on the player's touches and keys, the only time browsers allow it, and sends for the game's feel
 * with the first. An iPhone counts a touch only as it ends (touchend, click), never as the finger goes down. A phone
 * may stop the audio again (a call, the game in the background), sometimes leaving it "running" but mute: so this keeps
 * listening, and as the game comes back to the screen it stops the audio and starts it again. */
export function prepareSound(): void {
  const start = () => {
    loadFeel().catch(() => {});
    if (!soundOn.peek()) return;
    const c = context();
    if (c && c.state !== "running") unlock(c);
  };
  for (const event of ["touchend", "click", "keydown"])
    addEventListener(event, start, { capture: true, passive: true });
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
  const c = context();
  if (!c) return;
  if (c.state !== "running") {
    // Not started yet (the very first touch) or stopped by the phone: a sound asked for by a touch starts it.
    if (!touchedNow()) return;
    unlock(c);
  }
  if (!kit) {
    // The voices are on their way (the first touch sent for them): a sound asked for meanwhile plays as they come, if
    // that's soon, and is left out if not.
    const asked = performance.now();
    loadFeel().then(
      () => performance.now() - asked < 300 && voice(name, lift),
      () => {},
    );
    return;
  }
  let t0 = c.currentTime + 0.01;
  if (inTurn.has(name)) {
    if (freeAt - t0 > longestWait) return;
    t0 = Math.max(t0, freeAt);
    freeAt = t0 + kit.length(name) + 0.15;
  }
  kit.sound(c, name, lift, t0);
}

/** How an answer sounds: a right one a step of the scale higher for each before it in a row, up to an octave. */
export function playAnswer(kind: "exact" | "right" | "partial" | "wrong" | "time", inRow = 0): void {
  const right = kind === "exact" || kind === "right";
  voice(kind, right ? Math.min(Math.max(inRow - 1, 0), 5) : 0);
}

/** The beeps before a game starts: one for each of its last three seconds. */
export function playCount(secondsLeft: number): void {
  if (secondsLeft >= 1 && secondsLeft <= 3) play("count");
}
