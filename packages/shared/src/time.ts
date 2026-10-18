/** Calendar helpers pinned to Bulgarian time, so "today" and "this season" match what players see. */

export const TIME_ZONE = 'Europe/Sofia';

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

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

/** "2026-10-18" in Sofia time. */
export const dayKey = (ts = Date.now()) => dayFormat.format(ts);

/** Seasons are calendar months: "2026-10". */
export const seasonKey = (ts = Date.now()) => dayKey(ts).slice(0, 7);

function offsetAt(ts: number): number {
  const p = Object.fromEntries(partsFormat.formatToParts(ts).map((x) => [x.type, Number(x.value)]));
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

const MONTHS = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];

/** "Октомври 2026" */
export function seasonName(season: string): string {
  const [y, m] = season.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
