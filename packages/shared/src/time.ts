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

/** The Monday (a day key) of the week a day is in: weeks run Monday to Sunday, Sofia time. */
export function weekStart(day: string): string {
  const { y, m, d } = parseDay(day);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return shiftDay(day, -((weekday + 6) % 7));
}

/** When the week starting on this Monday ends: 00:00 Sofia time the next Monday. */
export const weekEndsAt = (monday: string) => dayEndsAt(shiftDay(monday, 6));

/** The first day of „Въпросите на деня“ (the day the site opened): №1. */
export const FIRST_DAY = '2026-10-25';

/** The day's number since the first, as the share text says it: "АЛМАНАХ №4". */
export const dayNumber = (day: string) => daysBetween(FIRST_DAY, day) + 1;

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

// Lowercase, as Bulgarian writes them in a sentence.
const MONTHS = [
  'януари',
  'февруари',
  'март',
  'април',
  'май',
  'юни',
  'юли',
  'август',
  'септември',
  'октомври',
  'ноември',
  'декември',
];

/** "октомври 2026", for a sentence: "Сезон октомври 2026". */
export function seasonName(season: string): string {
  const [y, m] = season.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "Октомври 2026": the season's name where it starts a heading or a label. */
export function seasonTitle(season: string): string {
  const name = seasonName(season);
  return name[0].toUpperCase() + name.slice(1);
}
