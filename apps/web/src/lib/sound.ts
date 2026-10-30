/**
 * The game's sounds, synthesized: no audio files to fetch or license. Each is a small instrument — a bell, a pluck, a
 * filtered burst of noise, a low thump — in one key (C major's pentatonic: C D E G A), through one master bus: a gain,
 * a compressor (a chord of effects never clips), and the gain back after it. Levels by role, measured offline: the big
 * moments near −6 dBFS at their peak, an answer's feedback near −10, the taps and ticks near −18 — they were 27 dB
 * apart, too quiet on a phone. A phone's speaker has nothing below ~300 Hz: what has to be felt there has a body in the
 * mids too, the low thump on top for headphones.
 */
import { useSyncExternalStore } from 'react';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = readMuted();
const listeners = new Set<() => void>();

function readMuted() {
  try {
    // window's, not the bare global: in the server's render (Node) that one exists only to print a warning.
    return window.localStorage.getItem('quiz:muted') === '1';
  } catch {
    return false;
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem('quiz:muted', value ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
  for (const listener of listeners) listener();
}

/** The mute setting as React state: every toggle (header, in-game, settings) stays in sync. */
export function useMuted(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, isMuted);
  return [value, setMuted];
}

/**
 * A buzz on phones that have it (Android; iOS ignores it). It follows the sound switch: whoever silenced the game
 * wants it quiet in the hand too.
 */
export function buzz(pattern: number | number[] | undefined) {
  if (muted || pattern === undefined) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not allowed here (an iframe, no user gesture yet) */
  }
}

/**
 * How long the audio engine runs after the last sound before it's put to sleep: a running context keeps the device's
 * audio output open (battery; on some Androids, the audio focus) for the rest of the visit. The next sound wakes it.
 */
const IDLE_MS = 10_000;
let idle: ReturnType<typeof setTimeout> | undefined;
const sleep = () => {
  if (ctx?.state === 'running') void ctx.suspend();
};

/** The audio graph, made the first time a sound plays: the context, and its master bus. */
function audio(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.2;
      master = ctx.createGain();
      master.gain.value = 0.8;
      // The compressor only brings the loud ones down: the gain after it brings them all up again (+8 dB).
      const makeup = ctx.createGain();
      makeup.gain.value = 2.5;
      master.connect(compressor).connect(makeup).connect(ctx.destination);
    }
    // Suspended until a tap, or asleep (IDLE_MS); „interrupted“ after a call on iOS: it has to be asked to run again.
    if (ctx.state !== 'running') void ctx.resume();
    clearTimeout(idle);
    idle = setTimeout(sleep, IDLE_MS);
    return ctx;
  } catch {
    return null;
  }
}

/**
 * iOS (and some Androids) keep audio silent until it's started inside a tap: the first tap, key or click on the page
 * starts it with a moment of silence, so the first real sound — often the countdown, with no tap of its own — plays.
 */
export function unlockAudioOnFirstTap() {
  const unlock = () => {
    const ac = audio();
    if (!ac) return;
    const silence = ac.createBufferSource();
    silence.buffer = ac.createBuffer(1, 1, ac.sampleRate);
    silence.connect(ac.destination);
    silence.start();
    if (ac.state === 'running') {
      for (const type of ['pointerdown', 'keydown', 'touchend'] as const) window.removeEventListener(type, unlock);
    }
  };
  for (const type of ['pointerdown', 'keydown', 'touchend'] as const)
    window.addEventListener(type, unlock, { passive: true });
  // In the background it sleeps; back (from a call, another app), it's asked to run again before the next sound.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sleep();
    else if (ctx && ctx.state !== 'running') void ctx.resume();
  });
}

// ─── Instruments ───────────────────────────────────────────────────────────

/** Notes of the key, by name (C5 = 523 Hz). */
const N = {
  A3: 220,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  G4: 392,
  A4: 440,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880,
  C6: 1046.5,
  D6: 1174.66,
  E6: 1318.51,
  G6: 1567.98,
  A6: 1760,
  C7: 2093,
} as const;

/** An envelope on a gain: a quick rise to `peak`, then an exponential fall over `decay`. */
function envelope(ac: AudioContext, t0: number, peak: number, attack: number, decay: number): GainNode {
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  amp.connect(master!);
  return amp;
}

/**
 * A bell: a sine with an inharmonic partial (2.76× its pitch) that dies faster — the glassy ring of right answers and
 * rewards.
 */
function bell(freq: number, at = 0, decay = 0.6, peak = 0.12) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + at;
  for (const [ratio, level, length] of [
    [1, 1, decay],
    [2.76, 0.35, decay * 0.4],
    [5.4, 0.12, decay * 0.2],
  ] as const) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    osc.connect(envelope(ac, t0, peak * level, 0.004, length));
    osc.start(t0);
    osc.stop(t0 + length + 0.05);
  }
}

/** A pluck: a bright tone through a low-pass filter that closes fast — a tap, a lock, a click of a dial. */
function pluck(freq: number, at = 0, decay = 0.18, peak = 0.1, type: OscillatorType = 'triangle') {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(freq * 8, t0);
  filter.frequency.exponentialRampToValueAtTime(freq * 1.5, t0 + decay);
  osc.connect(filter).connect(envelope(ac, t0, peak, 0.003, decay));
  osc.start(t0);
  osc.stop(t0 + decay + 0.05);
}

/** A detuned pair of saws through a closing filter, sliding: the sour, falling sound of a miss or a knockout. */
function buzzDown(from: number, to: number, at = 0, length = 0.35, peak = 0.07) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + at;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1800, t0);
  filter.frequency.exponentialRampToValueAtTime(300, t0 + length);
  filter.connect(envelope(ac, t0, peak, 0.01, length));
  for (const detune of [-14, 14]) {
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(to, t0 + length);
    osc.connect(filter);
    osc.start(t0);
    osc.stop(t0 + length + 0.05);
  }
}

/** A low thump: a sine dropping fast in pitch, felt more than heard. */
function thump(at = 0, from = 150, to = 45, length = 0.35, peak = 0.35) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(to, t0 + length);
  osc.connect(envelope(ac, t0, peak, 0.005, length));
  osc.start(t0);
  osc.stop(t0 + length + 0.05);
}

/** Filtered white noise: a whoosh (a sweep of the filter) or a soft click. */
function noise(at = 0, length = 0.25, from = 600, to = 4000, peak = 0.08, type: BiquadFilterType = 'bandpass') {
  const ac = audio();
  if (!ac) return;
  if (!noiseBuffer) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t0 = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(to, t0 + length);
  src.connect(filter).connect(envelope(ac, t0, peak, 0.01, length));
  src.start(t0);
  src.stop(t0 + length + 0.05);
}

// ─── The game's sounds ─────────────────────────────────────────────────────

export const sfx = {
  /** The last seconds: a dry tick, higher with each of the last three (`left`: seconds to go). */
  tick: (left = 5) => {
    const urgent = left <= 3;
    pluck(urgent ? [N.A5, N.C6, N.D6][3 - left] : N.G5, 0, 0.05, urgent ? 0.16 : 0.13, 'square');
  },
  lock: () => {
    noise(0, 0.05, 2500, 2500, 0.07, 'highpass');
    pluck(N.G5, 0.01, 0.12, 0.12);
  },
  /** A question coming in: a soft air past, under everything. */
  question: () => noise(0, 0.22, 450, 2400, 0.2),
  countdown: () => pluck(N.E5, 0, 0.16, 0.16, 'sine'),
  go: () => {
    noise(0, 0.18, 800, 5000, 0.04);
    bell(N.C6, 0, 0.35, 0.09);
    bell(N.G6, 0.07, 0.45, 0.07);
  },
  correct: () => {
    for (const [i, f] of [N.C6, N.E6, N.G6].entries()) bell(f, i * 0.055, 0.5, 0.058);
  },
  /** A miss: the sour slide, a dull knock in the mids a phone plays, and the low thump for headphones. */
  wrong: () => {
    buzzDown(N.E4, N.C4, 0, 0.3, 0.08);
    pluck(196, 0, 0.2, 0.12, 'triangle');
    noise(0, 0.1, 260, 180, 0.16, 'lowpass');
    thump(0, 120, 60, 0.2, 0.12);
  },
  /** Out of time, not wrong: two notes stepping down, a clock's, not a buzzer's. */
  timeUp: () => {
    pluck(N.E5, 0, 0.14, 0.075, 'square');
    pluck(N.A4, 0.12, 0.32, 0.09, 'triangle');
  },
  pop: () => pluck(N.C6, 0, 0.08, 0.12, 'sine'),
  powerup: () => {
    noise(0, 0.22, 500, 6000, 0.05);
    for (const [i, f] of [N.G5, N.C6, N.E6].entries()) pluck(f, 0.03 + i * 0.045, 0.14, 0.07);
  },
  /** Someone else is out: a whoosh past, and a low note — theirs, not yours. */
  eliminated: () => {
    noise(0, 0.35, 3000, 300, 0.07);
    pluck(N.E4, 0.05, 0.4, 0.12, 'triangle');
  },
  /** You're out: a slow fall through the minor of the key, a heavy knock in the mids, and the floor. */
  knockedOut: () => {
    buzzDown(N.A4, N.A3, 0, 0.45, 0.08);
    buzzDown(N.E4, N.C4, 0.18, 0.6, 0.07);
    pluck(N.A3, 0.02, 0.5, 0.16, 'triangle');
    noise(0.02, 0.16, 300, 160, 0.14, 'lowpass');
    thump(0.05, 140, 38, 0.6, 0.18);
  },
  /** A streak of right answers (3, 5, 10…): a rising run, higher the longer it gets. */
  streak: (length: number) => {
    const notes = length >= 10 ? [N.C6, N.E6, N.G6, N.C7] : length >= 5 ? [N.G5, N.C6, N.E6, N.G6] : [N.E5, N.G5, N.C6];
    noise(0, 0.25, 1500, 8000, 0.035);
    for (const [i, f] of notes.entries()) bell(f, i * 0.05, 0.35, 0.07);
  },
  /** In a Дуел, the lead changes hands: up when it's yours, down when it isn't any more. */
  lead: (yours: boolean) => {
    const [a, b] = yours ? [N.G5, N.C6] : [N.C6, N.G5];
    pluck(a, 0, 0.14, 0.08);
    pluck(b, 0.09, 0.22, 0.08);
  },
  win: () => {
    for (const [i, f] of [N.C5, N.E5, N.G5, N.C6, N.G5, N.C6, N.E6].entries())
      bell(f, i * 0.1, i === 6 ? 0.9 : 0.3, 0.12);
    noise(0.6, 0.5, 2000, 9000, 0.04);
  },
  /** A match lost: three notes settling down, kind — it's a game, there's the next one. */
  lose: () => {
    for (const [i, f] of [N.E5, N.C5, N.A4].entries()) bell(f, i * 0.16, i === 2 ? 0.9 : 0.45, 0.05);
  },
  levelUp: () => {
    for (const [i, f] of [N.G5, N.A5, N.C6, N.E6, N.G6].entries()) bell(f, i * 0.065, 0.5, 0.09);
  },
  achievement: () => {
    bell(N.C6, 0, 0.4, 0.12);
    bell(N.G6, 0.1, 0.7, 0.11);
  },
  /** An invite: two soft notes, a doorbell. */
  invite: () => {
    bell(N.E6, 0, 0.35, 0.05);
    bell(N.C6, 0.16, 0.55, 0.05);
  },
};
