// The game's feel, in a file of its own: the sounds' voices. It loads after the player's first touch (lib/sound.ts
// starts it), since nothing sounds before one, and the first screen doesn't wait for it; until it's in, the game is
// whole and only quieter. Like a screen that loads on its own (kit.ts), it imports nothing of the app but types: what
// it needs comes as arguments, so nothing is split into a file every page would load first.

import type { SoundName } from "./lib/sound.ts";

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

/** How long a sound lasts (s). */
export function length(name: SoundName): number {
  return Math.max(...sounds[name].map(([, at, long]) => at + long));
}

/** Plays a sound into `out` from `t0` (in the audio's time), `lift` semitones higher. */
export function sound(c: AudioContext, out: AudioNode, name: SoundName, lift: number, t0: number): void {
  const pitch = 2 ** (lift / 12);
  for (const [hz, at, long, wave = "triangle", loud = 1] of sounds[name]) {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = wave;
    osc.frequency.value = hz * pitch;
    env.gain.setValueAtTime(0.0001, t0 + at);
    env.gain.exponentialRampToValueAtTime(loud, t0 + at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + at + long);
    osc.connect(env).connect(out);
    osc.start(t0 + at);
    osc.stop(t0 + at + long + 0.02);
  }
}
