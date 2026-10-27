/** Tiny synthesized sound effects — no audio files needed. */
import { useSyncExternalStore } from 'react';

let ctx: AudioContext | null = null;
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

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  start: number,
  duration: number,
  type: OscillatorType = 'sine',
  gain = 0.12,
  slideTo?: number,
) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export const sfx = {
  tick: () => tone(1250, 0, 0.05, 'square', 0.03),
  lock: () => tone(520, 0, 0.09, 'triangle', 0.08, 780),
  countdown: () => tone(660, 0, 0.14, 'sine', 0.1),
  go: () => {
    tone(880, 0, 0.12, 'sine', 0.1);
    tone(1320, 0.08, 0.22, 'sine', 0.1);
  },
  correct: () => {
    for (const [i, f] of [523, 659, 784, 1047].entries()) tone(f, i * 0.06, 0.22, 'triangle', 0.09);
  },
  wrong: () => {
    tone(220, 0, 0.28, 'sawtooth', 0.05, 140);
    tone(185, 0.05, 0.3, 'square', 0.03, 110);
  },
  pop: () => tone(900, 0, 0.07, 'sine', 0.06, 1400),
  powerup: () => {
    for (const [i, f] of [700, 1050, 1400].entries()) tone(f, i * 0.04, 0.12, 'sine', 0.07);
  },
  eliminated: () => {
    tone(160, 0, 0.5, 'sawtooth', 0.06, 60);
    tone(90, 0.02, 0.6, 'sine', 0.12, 45);
  },
  win: () => {
    for (const [i, f] of [523, 659, 784, 1047, 784, 1047, 1319].entries())
      tone(f, i * 0.11, i === 6 ? 0.6 : 0.16, 'triangle', 0.09);
  },
  levelUp: () => {
    for (const [i, f] of [784, 988, 1175, 1568, 1976].entries()) tone(f, i * 0.07, 0.3, 'sine', 0.08);
  },
  achievement: () => {
    tone(1047, 0, 0.18, 'sine', 0.08);
    tone(1568, 0.1, 0.4, 'sine', 0.08);
  },
};
