import { SCORING } from '@almanac/shared';

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

/** Two players' duels so far, you first: "3 : 2" (and the draws, if any). */
export const recordLine = (r: { wins: number; losses: number; draws: number }) =>
  `${r.wins} : ${r.losses}${r.draws ? ` · ${r.draws} равни` : ''}`;

export { ordinal } from '@almanac/shared';

export const DIFFICULTY_LABEL = { easy: 'Лесен', medium: 'Среден', hard: 'Труден' } as const;

/** Answer letters and accent colours: the same in the match, the review afterwards, the question editor and admin. */
export const LETTERS = ['А', 'Б', 'В', 'Г'];
export const OPTION_COLORS = ['#a78bfa', '#22d3ee', '#fbbf24', '#f472b6'];

/**
 * Time left, in words while it's long — „21 ч. 56 мин.“, „49 мин.“ (abbreviated with the dot, as everywhere in the
 * game) — and as a ticking clock only in its last ten minutes, „4:12“: a clock for hours away („след 21:56:34“, next to
 * „в 21:00“) read as a time of day.
 */
export function countdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours} ч. ${minutes} мин.` : `${hours} ч.`;
  if (minutes >= 10) return `${minutes} мин.`;
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/** How points are counted, in one line: speed is half of every answer's worth, and nothing in the game said so. */
export const SCORING_LINE = `${SCORING.base} точки за верен отговор, до +${SCORING.speed} за бързина (след време за четене) и +${SCORING.streakStep} за всеки пореден верен (до +${SCORING.streakMax}).`;

const LICENSES: Record<string, string> = { PD: 'обществено достояние' };

/** A picture's licence as the credit line says it („CC BY-SA 3.0“, „обществено достояние“). */
export const licenseName = (license: string) => LICENSES[license] ?? license;

/** The credit's own source is Wikimedia Commons (and the credit doesn't say so already): said once, after it. */
export const fromCommons = (c: { sourceUrl: string | null; credit: string }) =>
  !!c.sourceUrl?.startsWith('https://commons.wikimedia.org/') && !/wikimedia/i.test(c.credit);
