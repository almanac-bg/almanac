import { decimalsOf, isExact, type NumberInput } from '@quiz/shared';

/** A unit written in the plural, as its one: „1 ден“, not „1 дни“ (a host's own question can count in words). */
const ONE: Record<string, string> = {
  дни: 'ден',
  години: 'година',
  месеца: 'месец',
  седмици: 'седмица',
  часа: 'час',
  минути: 'минута',
  секунди: 'секунда',
  пъти: 'път',
  души: 'човек',
  броя: 'брой',
  страни: 'страна',
  града: 'град',
  метра: 'метър',
  километра: 'километър',
};

/** A number as Bulgarian writes it: a decimal comma, a space every three digits from 10 000 on, then its unit. */
export function numberText(value: number, n: Pick<NumberInput, 'unit' | 'step'>): string {
  const digits = decimalsOf(n.step);
  const text = value.toLocaleString('bg-BG', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const unit = value === 1 ? (ONE[n.unit] ?? n.unit) : n.unit;
  return unit ? `${text} ${unit}` : text;
}

/**
 * How far off a guess is, in a few characters: "точно", "+3", "−120 км"; on a log scale by a factor ("×2,5", "÷1,3"),
 * since a difference in millions says little.
 */
export function offText(guess: number, answer: number, n: Pick<NumberInput, 'unit' | 'step' | 'scale'>): string {
  if (isExact(guess, { answer, step: n.step })) return 'точно';
  if (n.scale === 'log') {
    const factor = guess > answer ? guess / answer : answer / guess;
    return `${guess > answer ? '×' : '÷'}${factor.toLocaleString('bg-BG', { maximumFractionDigits: 1 })}`;
  }
  return `${guess > answer ? '+' : '−'}${numberText(Math.abs(guess - answer), n)}`;
}

/** Where a value sits on a line from `lo` to `hi` (0–1), evenly or by orders of magnitude. */
export function placeOn(value: number, lo: number, hi: number, scale: NumberInput['scale']): number {
  const at = (v: number) => (scale === 'log' ? Math.log(Math.max(v, Number.MIN_VALUE)) : v);
  const span = at(hi) - at(lo);
  return span > 0 ? (at(value) - at(lo)) / span : 0.5;
}

/** A line wide enough for the answer and every guess, with a margin, never narrower than a few steps. */
export function lineRange(values: number[], n: Pick<NumberInput, 'step' | 'scale' | 'min' | 'max'>): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (n.scale === 'log') {
    const pad = Math.max(1.25, (hi / lo) ** 0.15);
    return [Math.max(n.min, lo / pad), Math.min(n.max, hi * pad)];
  }
  const pad = Math.max((hi - lo) * 0.15, n.step * 5);
  return [Math.max(n.min, lo - pad), Math.min(n.max, hi + pad)];
}

/** The most characters a typed number can have: enough for the range's ends, a sign and the step's decimals. */
export function maxDigits(n: Pick<NumberInput, 'min' | 'max' | 'step'>): number {
  const whole = Math.max(String(Math.trunc(Math.abs(n.min))).length, String(Math.trunc(Math.abs(n.max))).length);
  return whole + decimalsOf(n.step);
}
