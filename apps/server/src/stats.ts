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
  /** New players who finished a first match, counted on the day they joined: what retention is a share of. */
  | 'starters'
  | 'returned_d1'
  | 'returned_d7'
  | 'returned_d30'
  | 'challenges'
  | 'challenge_runs'
  /** Friend duels made (a challenge for one friend). */
  | 'duels'
  /** Дуели against a recording of a real player's match, nobody else being there. */
  | 'record_matches'
  | 'evening_matches'
  | 'daily_runs'
  /** Daily runs played to the end (of `daily_runs`, which counts the starts). */
  | 'daily_finished'
  | 'reminders'
  /** A player stopped on a "Знаеше ли?" fact to read it. */
  | 'fact_holds'
  | `matches:${string}`
  /**
   * Shared links: opened (the page asked for its preview), then used (played the challenge or the daily from it,
   * joined the group, copied the set). By kind: challenge, daily, group, set.
   */
  | `link_opens:${LinkKind}`
  | `link_uses:${LinkKind}`
  /** Delivery reports from the mail provider, by kind (bounces, spam complaints…). */
  | `email_events:${string}`;

export type LinkKind = 'challenge' | 'daily' | 'group' | 'set';

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

/**
 * A player's first match of the day: one more active player, and a return for the day they joined (D1, D7, D30).
 * `first`: their first match ever, which makes them a starter of the day they joined.
 */
export function countActive(createdAt: number, today = dayKey(), first = false) {
  count('active', 1, today);
  const joined = dayKey(createdAt);
  if (first) count('starters', 1, joined);
  const after = daysBetween(joined, today);
  if (after === 1) count('returned_d1', 1, joined);
  if (after === 7) count('returned_d7', 1, joined);
  if (after === 30) count('returned_d30', 1, joined);
}

export interface StatsDay {
  day: string;
  values: Partial<Record<string, number>>;
}

/** 90 days: enough two-week cohorts for the D30 return, and a quarter's trend. */
export function launchStats(days = 90, today = dayKey()) {
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
