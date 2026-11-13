// Sounds: short tones made in the browser (no files), for a game's moments — a pick, a right or a wrong answer, the
// clock ticking and its last seconds, the end, a new level or achievement, a duel starting. On unless the player turns them off (kept on
// this device). Browsers allow sound only once the player has touched the page, so the audio starts then.

import { signal } from "./dom.ts";

export type SoundName =
  | "tap"
  | "key"
  | "tick"
  | "tock"
  | "hurry"
  | "right"
  | "exact"
  | "partial"
  | "wrong"
  | "time"
  | "end"
  | "level"
  | "achievement"
  | "ping";

/** A tone: its pitch (Hz), when it starts and how long it lasts (s), its wave, and how loud (0–1). */
type Note = [hz: number, at: number, length: number, wave?: OscillatorType, loud?: number];

// Notes in Hz: C5 523, E5 659, G5 784, C6 1047, D6 1175, E6 1319, G6 1568, A6 1760, C7 2093.
const sounds: Record<SoundName, Note[]> = {
  tap: [[660, 0, 0.05, "sine", 0.45]],
  key: [[880, 0, 0.03, "sine", 0.3]],
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
  wrong: [
    [220, 0, 0.15, "sawtooth", 0.28],
    [175, 0.12, 0.24, "sawtooth", 0.28],
  ],
  time: [
    [330, 0, 0.14, "square", 0.22],
    [247, 0.14, 0.26, "square", 0.22],
  ],
  end: [
    [523, 0, 0.12],
    [659, 0.1, 0.12],
    [784, 0.2, 0.32],
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
  ping: [
    [988, 0, 0.1, "sine"],
    [1319, 0.1, 0.22, "sine"],
  ],
};

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

let audio: AudioContext | null = null;
let out: GainNode | null = null;

function context(): AudioContext | null {
  if (audio) return audio;
  if (typeof AudioContext === "undefined") return null;
  try {
    audio = new AudioContext();
  } catch {
    return null;
  }
  out = audio.createGain();
  out.gain.value = 0.22; // quiet: the game is often played among people
  out.connect(audio.destination);
  return audio;
}

/** Starts the audio on the player's first touch or key (the only time browsers allow it). */
export function prepareSound(): void {
  const start = () => {
    if (soundOn.peek()) void context()?.resume();
  };
  addEventListener("pointerdown", start, { passive: true });
  addEventListener("keydown", start);
}

/** Plays a sound, if sounds are on and the browser allows them yet (else nothing: never a backlog later). */
export function play(name: SoundName): void {
  if (!soundOn.peek()) return;
  const c = context();
  if (!c || !out || c.state !== "running") return;
  const t0 = c.currentTime + 0.01;
  for (const [hz, at, length, wave = "triangle", loud = 1] of sounds[name]) {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = wave;
    osc.frequency.value = hz;
    env.gain.setValueAtTime(0.0001, t0 + at);
    env.gain.exponentialRampToValueAtTime(loud, t0 + at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + at + length);
    osc.connect(env).connect(out);
    osc.start(t0 + at);
    osc.stop(t0 + at + length + 0.02);
  }
}
