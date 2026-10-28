const numberFormat = new Intl.NumberFormat('bg-BG');
// Not every JS engine (e.g. some Hermes builds) ships RelativeTimeFormat — fall back to plain Bulgarian.
const relative =
  typeof Intl.RelativeTimeFormat === 'function' ? new Intl.RelativeTimeFormat('bg', { numeric: 'auto' }) : null;
const UNIT_BG: Record<string, [string, string]> = {
  year: ['година', 'години'],
  month: ['месец', 'месеца'],
  week: ['седмица', 'седмици'],
  day: ['ден', 'дни'],
  hour: ['час', 'часа'],
  minute: ['минута', 'минути'],
};

export const fmt = (n: number) => numberFormat.format(Math.round(n));

/** 1530 → "1,5 с" */
export const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} с`;

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** A share, 0–1, as a percentage: 0.623 → "62%". */
export const percent = (share: number) => `${Math.round(share * 100)}%`;

export const longDate = (ts: number) =>
  new Date(ts).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' });

export function timeAgo(ts: number): string {
  const diff = (ts - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(diff) < size) continue;
    const n = Math.round(diff / size);
    if (relative) return relative.format(n, unit);
    const [one, many] = UNIT_BG[unit];
    const amount = `${Math.abs(n)} ${Math.abs(n) === 1 ? one : many}`;
    return n < 0 ? `преди ${amount}` : `след ${amount}`;
  }
  return 'току-що';
}

/** Bulgarian has one form for 1 and another for everything else. */
export const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

export { ordinal } from '@quiz/shared';

export const DIFFICULTY_LABEL = { easy: 'Лесен', medium: 'Среден', hard: 'Труден' } as const;
