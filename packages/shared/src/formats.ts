import { SCORING } from './progression';

/**
 * A picture over the question (a flag, a landmark, a painting). Recognising one takes less than reading a question: a
 * shorter clock (except in rooms, where the host's clock is everyone's), and a moment more to take the picture in
 * before the speed bonus starts to drain. Never the first question (its picture is fetched during the reveal before
 * it) and not at the end of a match.
 */
export const IMAGE = {
  timeMs: 12_000,
  readExtraMs: 1_000,
  /** At most this many in a match of IMAGE.fullMatch questions or more; one in a shorter one, and in the daily. */
  perMatch: 2,
  fullMatch: 8,
  /** Where they may go (0-based): Q2–Q8. */
  first: 1,
  last: 7,
  /** Each picture is kept twice: its longer side this long (a big screen's), and half that (a phone's). */
  side: 1200,
  /** The most one file may weigh. */
  maxBytes: 150_000,
  /** An image question's text: the picture carries the rest. */
  questionMax: 60,
} as const;

/**
 * What a match's draw holds besides questions with options: up to `images` about a picture (IMAGE), and one order
 * question („Подреди“) if `order`. Each mode says which (MODES).
 */
export interface Formats {
  images: number;
  order: boolean;
}

export const TEXT_ONLY: Formats = { images: 0, order: false };

/** A picture as a player gets it with the question: what to load, its shape, and what it shows, for screen readers. */
export interface QuestionImage {
  /** The small size (half of IMAGE.side). */
  src: string;
  /** Both sizes, for the browser to pick from. */
  srcSet: string;
  w: number;
  h: number;
  /** What's in it, without the answer. */
  alt: string;
}

/** Whose a picture is and on what licence: shown with the answer (a painter's name would give a painting away). */
export interface ImageCredit {
  credit: string;
  license: string;
  sourceUrl: string | null;
}

/**
 * „Подреди“: four things put in order by a number each has (a year, a height). ORDER.perItem for each one in its right
 * place; all four right also earn a speed bonus of up to ORDER.speed (half a question's) and keep a streak going.
 * Four taps take longer than one: a longer clock.
 */
export const ORDER = { timeMs: 20_000, items: 4, perItem: 250, speed: 250 } as const;

export type OrderDirection = 'asc' | 'desc';

/** A player's order is well formed: each of the shown items exactly once. */
export function isOrder(order: unknown, items: number = ORDER.items): order is number[] {
  return (
    Array.isArray(order) &&
    order.length === items &&
    order.every((i) => Number.isInteger(i) && i >= 0 && i < items) &&
    new Set(order).size === items
  );
}

/** How many items of `given` are in their right place (both list the shown items' indices, first to last). */
export function placedRight(given: readonly number[] | null, right: readonly number[]): number {
  if (!given) return 0;
  return right.reduce((n, item, place) => n + (given[place] === item ? 1 : 0), 0);
}

/** The right order of items with these values: their indices, smallest first (`asc`) or largest first. */
export function rightOrder(values: readonly number[], direction: OrderDirection): number[] {
  return values.map((_, i) => i).sort((a, b) => (direction === 'asc' ? values[a] - values[b] : values[b] - values[a]));
}

/**
 * What an order scores: ORDER.perItem for each item in its place; all of them right add the speed bonus (over the time
 * left after the reading window) and the streak bonus. `streak` counts this answer.
 */
export function orderPoints(a: {
  right: number;
  timeMs: number;
  limitMs: number;
  readMs: number;
  streak: number;
  untimed?: boolean;
}) {
  const base = ORDER.perItem * a.right;
  if (a.right < ORDER.items) return base;
  const drained = Math.max(0, a.timeMs - a.readMs) / Math.max(1, a.limitMs - a.readMs);
  const speed = a.untimed ? 0 : Math.round(ORDER.speed * Math.max(0, 1 - drained));
  return base + speed + Math.min((a.streak - 1) * SCORING.streakStep, SCORING.streakMax);
}
