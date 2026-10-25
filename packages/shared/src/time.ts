/** Calendar helpers pinned to Bulgarian time, so "today" and "this season" match what players see. */

export const TIME_ZONE = 'Europe/Sofia';

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** Sofia wall-clock fields, from parts rather than a locale's date format (which differs between JS engines). */
function sofiaParts(ts: number) {
  return Object.fromEntries(partsFormat.formatToParts(ts).map((x) => [x.type, Number(x.value)])) as Record<
    'year' | 'month' | 'day' | 'hour' | 'minute' | 'second',
    number
  >;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-18" in Sofia time. */
export function dayKey(ts = Date.now()) {
  const p = sofiaParts(ts);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Hour of the day (0–23) in Sofia time. */
export const sofiaHour = (ts = Date.now()) => sofiaParts(ts).hour;

/** Seasons are calendar months: "2026-10". */
export const seasonKey = (ts = Date.now()) => dayKey(ts).slice(0, 7);

function offsetAt(ts: number): number {
  const p = sofiaParts(ts);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}

/** Timestamp of 00:00 Sofia time on the given calendar date (month is 1-based, overflow allowed). */
export function sofiaMidnight(year: number, month: number, day: number): number {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

function parseDay(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return { y, m, d };
}

export function shiftDay(day: string, delta: number): string {
  const { y, m, d } = parseDay(day);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to` (both day keys): 1 for consecutive days. */
export function daysBetween(from: string, to: string): number {
  const a = parseDay(from);
  const b = parseDay(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export function dayEndsAt(day: string): number {
  const { y, m, d } = parseDay(day);
  return sofiaMidnight(y, m, d + 1);
}

export function shiftSeason(season: string, delta: number): string {
  const [y, m] = season.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function seasonEndsAt(season: string): number {
  const [y, m] = season.split('-').map(Number);
  return sofiaMidnight(y, m + 1, 1);
}

const MONTHS = [
  'Януари',
  'Февруари',
  'Март',
  'Април',
  'Май',
  'Юни',
  'Юли',
  'Август',
  'Септември',
  'Октомври',
  'Ноември',
  'Декември',
];

/** "Октомври 2026" */
export function seasonName(season: string): string {
  const [y, m] = season.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
