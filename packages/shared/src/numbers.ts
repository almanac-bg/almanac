/**
 * "Колко…?", "През коя година…?": a number typed in, scored by how close it is. On a linear scale a guess `tolerance`
 * away scores nothing; on a log scale (sizes spanning orders of magnitude), one `tolerance` times too big or too small.
 */
export interface NumberSpec {
  answer: number;
  /** What the number counts ("км", "души"); empty for a year. */
  unit: string;
  /** The range the keypad or slider allows. */
  min: number;
  max: number;
  step: number;
  scale: 'linear' | 'log';
  tolerance: number;
}

/** What a player gets with the question: the range to guess in, not the answer or how close counts. */
export type NumberInput = Pick<NumberSpec, 'unit' | 'min' | 'max' | 'step' | 'scale'>;

export const NUMBER = {
  /** Its clock: typing a number takes longer than a tap. */
  timeMs: 20_000,
  /** A guess spot on scores this, less the further off it is; no speed bonus (the time only breaks ties). */
  points: 1000,
  /** On top, for the exact number (within half a step). */
  exactBonus: 250,
  /** This close keeps a streak going, and counts as a right answer. */
  rightFrom: 0.8,
} as const;

/** How close a guess is: 1 spot on, down to 0 a tolerance away (on a log scale, a tolerance-fold). */
export function closeness(guess: number, n: Pick<NumberSpec, 'answer' | 'scale' | 'tolerance'>): number {
  const off =
    n.scale === 'log'
      ? Math.abs(Math.log(guess / n.answer)) / Math.log(n.tolerance)
      : Math.abs(guess - n.answer) / n.tolerance;
  return Number.isFinite(off) ? Math.max(0, 1 - off) : 0;
}

/** The exact number: within half a step of it (a year is exact only as that year). */
export const isExact = (guess: number, n: Pick<NumberSpec, 'answer' | 'step'>) =>
  Math.abs(guess - n.answer) <= n.step / 2 + 1e-9;

export function numberPoints(guess: number, n: Pick<NumberSpec, 'answer' | 'scale' | 'tolerance' | 'step'>) {
  return Math.round(NUMBER.points * closeness(guess, n)) + (isExact(guess, n) ? NUMBER.exactBonus : 0);
}

/** A typed number brought onto the question's grid: inside its range, in whole steps (no float noise). */
export function snapNumber(value: number, n: Pick<NumberSpec, 'min' | 'max' | 'step'>): number {
  const inRange = Math.min(n.max, Math.max(n.min, value));
  return Number((Math.round(inRange / n.step) * n.step).toFixed(decimalsOf(n.step)));
}

/** How many decimals a step has (0.5 → 1, 0.25 → 2, 10 → 0). */
export function decimalsOf(step: number): number {
  const [, fraction = ''] = String(step).split('.');
  return fraction.length;
}
