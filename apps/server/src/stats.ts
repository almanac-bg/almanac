import { dayKey, daysBetween, shiftDay } from '@quiz/shared';
import { all, one, run } from './db';

/**
 * Launch statistics without tracking anyone: daily counters bumped as things happen (no cookies, no third parties).
 * Retention is counted against the day an account was made: "returned_d1" on day D = players who joined on D and
 * played again the next day.
 */
export type Metric =
  | 'signups'
  | 'guests'
  | 'claims'
  | 'active'
  | 'returned_d1'
  | 'returned_d7'
  | 'challenges'
  | 'challenge_runs'
  | 'daily_runs'
  | 'reminders'
  | `matches:${string}`
  /** Delivery reports from the mail provider, by kind (bounces, spam complaints…). */
  | `email_events:${string}`;

export function count(metric: Metric, by = 1, day = dayKey()) {
  if (by <= 0) return;
  run(
    `INSERT INTO daily_stats (day, metric, value) VALUES (?, ?, ?)
     ON CONFLICT (day, metric) DO UPDATE SET value = value + excluded.value`,
    day,
    metric,
    by,
  );
}

/** A player's first match of the day: one more active player, and a return for the day they joined (D1, D7). */
export function countActive(createdAt: number, today = dayKey()) {
  count('active', 1, today);
  const joined = dayKey(createdAt);
  const after = daysBetween(joined, today);
  if (after === 1) count('returned_d1', 1, joined);
  if (after === 7) count('returned_d7', 1, joined);
}

export interface StatsDay {
  day: string;
  values: Partial<Record<string, number>>;
}

export function launchStats(days = 30, today = dayKey()) {
  const from = shiftDay(today, -(days - 1));
  const rows = all<{ day: string; metric: string; value: number }>(
    'SELECT day, metric, value FROM daily_stats WHERE day >= ? ORDER BY day',
    from,
  );
  const byDay = new Map<string, StatsDay>();
  for (let i = 0; i < days; i++) {
    const day = shiftDay(from, i);
    byDay.set(day, { day, values: {} });
  }
  for (const r of rows) byDay.get(r.day)!.values[r.metric] = r.value;
  return {
    days: [...byDay.values()].reverse(),
    totals: one<{ accounts: number; guests: number; matches: number }>(
      `SELECT (SELECT COUNT(*) FROM users WHERE is_guest = 0) AS accounts, (SELECT COUNT(*) FROM users WHERE is_guest = 1) AS guests,
       (SELECT COUNT(*) FROM matches) AS matches`,
    )!,
  };
}
