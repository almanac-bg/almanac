// Sounds: short tones made in the browser (no files), for a game's moments — a pick, the other side answering, the
// count before a game and its start, the clock ticking and its last seconds, a right answer (higher with each one in
// a row), a wrong one or none, the end (won, lost or just over), a goal done, a new level or achievement, and
// something new waiting. On unless the player turns them off (kept on this device).
//
// Browsers allow sound only once the player has touched the page, so the audio starts then. The bigger sounds (an
// end, a level, an achievement…) take turns: one asked for while another still sounds follows it, never on top. On
// a phone the sounds mix with whatever the player is listening to and keep quiet with the silent switch.

import { signal } from "./dom.ts";

export type SoundName =
  | "tap"
  | "key"
  | "them"
  | "count"
  | "go"
  | "tick"
  | "tock"
  | "hurry"
  | "right"
  | "exact"
  | "partial"
  | "wrong"
  | "time"
  | "end"
  | "win"
  | "lose"
  | "goal"
  | "level"
  | "achievement"
  | "ping";

/** A tone: its pitch (Hz), when it starts and how long it lasts (s), its wave, and how loud (0–1). */
type Note = [hz: number, at: number, length: number, wave?: OscillatorType, loud?: number];

// Notes in Hz: A3 220, D4 294, G4 392, A4 440, C5 523, D5 587, E5 659, G5 784, A5 880, B5 988, C6 1047, D6 1175, E6 1319, G6 1568,
// A6 1760, C7 2093.
const sounds: Record<SoundName, Note[]> = {
  // The player's own touch: a pick, a digit.
  tap: [[660, 0, 0.05, "sine", 0.45]],
  key: [[880, 0, 0.03, "sine", 0.3]],
  // Someone else: the other side answering, a player coming into the room. Soft and falling, unlike a tap.
  them: [
    [587, 0, 0.06, "sine", 0.3],
    [440, 0.05, 0.1, "sine", 0.25],
  ],
  // Before a game: a beep for each of the last seconds, then an octave up for the start.
  count: [[880, 0, 0.09, "sine", 0.5]],
  go: [
    [1760, 0, 0.3, "sine", 0.5],
    [880, 0, 0.3, "triangle", 0.35],
  ],
  // The clock: a soft tick-tock every second, then a sharper beep for each of the last five.
  tick: [[2100, 0, 0.022, "triangle", 0.3]],
  tock: [[1600, 0, 0.022, "triangle", 0.3]],
  hurry: [
    [1760, 0, 0.05, "square", 0.22],
    [1760, 0.09, 0.05, "square", 0.16],
  ],
  right: [
    [784, 0, 0.12],
    [1175, 0.09, 0.24],
  ],
  exact: [
    [784, 0, 0.1],
    [1047, 0.08, 0.1],
    [1568, 0.16, 0.32],
  ],
  partial: [[659, 0, 0.2]],
  // A wrong answer and none: low, falling, a little softer than a right one, but high enough for a phone's speaker
  // (which gives little below 300 Hz).
  wrong: [
    [294, 0, 0.15, "sawtooth", 0.8],
    [220, 0.12, 0.28, "sawtooth", 0.8],
  ],
  time: [
    [392, 0, 0.14, "square", 0.4],
    [294, 0.14, 0.28, "square", 0.4],
  ],
  // The end: just over (a game played alone, a place in the middle), won, lost.
  end: [
    [523, 0, 0.12],
    [659, 0.1, 0.12],
    [784, 0.2, 0.32],
  ],
  win: [
    [784, 0, 0.1],
    [1047, 0.1, 0.1],
    [1319, 0.2, 0.1],
    [1568, 0.3, 0.6],
    [1047, 0.3, 0.6, "triangle", 0.45],
    [1319, 0.3, 0.6, "triangle", 0.45],
  ],
  lose: [
    [659, 0, 0.16, "sine", 0.6],
    [523, 0.14, 0.16, "sine", 0.55],
    [440, 0.28, 0.42, "sine", 0.5],
  ],
  // A day's goal done: a bright coin.
  goal: [
    [988, 0, 0.07, "square", 0.45],
    [1319, 0.07, 0.3, "square", 0.45],
  ],
  level: [
    [523, 0, 0.1],
    [659, 0.09, 0.1],
    [784, 0.18, 0.1],
    [1047, 0.27, 0.5],
  ],
  achievement: [
    [1319, 0, 0.08, "sine"],
    [1760, 0.07, 0.08, "sine"],
    [2093, 0.14, 0.38, "sine"],
  ],
  // Something new: an opponent found, a friend's challenge or request.
  ping: [
    [988, 0, 0.1, "sine"],
    [1319, 0.1, 0.22, "sine"],
  ],
};

/** The bigger sounds, which take turns rather than sound over each other. */
const inTurn = new Set<SoundName>(["end", "win", "lose", "goal", "level", "achievement"]);
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
let out: AudioNode | null = null;
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
  const gain = audio.createGain();
  gain.gain.value = 0.22; // quiet: the game is often played among people
  // A gentle top cut takes the edge off the square and sawtooth tones (the hurry beeps, a wrong answer).
  const soften = audio.createBiquadFilter();
  soften.type = "lowpass";
  soften.frequency.value = 5000;
  soften.Q.value = 0.5;
  gain.connect(soften).connect(audio.destination);
  out = gain;
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

/** Starts the audio on the player's touches and keys, the only time browsers allow it. An iPhone counts a touch only
 * as it ends (touchend, click), never as the finger goes down. A phone may stop the audio again (a call, the game in
 * the background), sometimes leaving it "running" but mute: so this keeps listening, and as the game comes back to
 * the screen it stops the audio and starts it again. */
export function prepareSound(): void {
  const start = () => {
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
 * it by that many semitones. */
export function play(name: SoundName, lift = 0): void {
  if (!soundOn.peek()) return;
  const c = context();
  if (!c || !out) return;
  if (c.state !== "running") {
    // Not started yet (the very first touch) or stopped by the phone: a sound asked for by a touch starts it.
    if (!touchedNow()) return;
    unlock(c);
  }
  const notes = sounds[name];
  let t0 = c.currentTime + 0.01;
  if (inTurn.has(name)) {
    if (freeAt - t0 > longestWait) return;
    t0 = Math.max(t0, freeAt);
    freeAt = t0 + Math.max(...notes.map(([, at, length]) => at + length)) + 0.15;
  }
  const pitch = 2 ** (lift / 12);
  for (const [hz, at, length, wave = "triangle", loud = 1] of notes) {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = wave;
    osc.frequency.value = hz * pitch;
    env.gain.setValueAtTime(0.0001, t0 + at);
    env.gain.exponentialRampToValueAtTime(loud, t0 + at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + at + length);
    osc.connect(env).connect(out);
    osc.start(t0 + at);
    osc.stop(t0 + at + length + 0.02);
  }
}

/** How an answer sounds: a right one a semitone higher for each before it in a row, up to a fifth. */
export function playAnswer(kind: "exact" | "right" | "partial" | "wrong" | "time", inRow = 0): void {
  const right = kind === "exact" || kind === "right";
  play(kind, right ? Math.min(Math.max(inRow - 1, 0), 7) : 0);
}

/** The beeps before a game starts: one for each of its last three seconds. */
export function playCount(secondsLeft: number): void {
  if (secondsLeft >= 1 && secondsLeft <= 3) play("count");
}
