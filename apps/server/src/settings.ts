import { randomBytes } from 'node:crypto';
import { one, run } from './db';

/** New guests turned away for now (`cli guests off`): the brake for a flood of them from many networks at once. */
export const guestsPaused = () =>
  one<{ value: string }>("SELECT value FROM settings WHERE key = 'guests_paused'") !== undefined;

export function pauseGuests(paused: boolean) {
  if (paused) run("INSERT OR IGNORE INTO settings (key, value) VALUES ('guests_paused', '1')");
  else run("DELETE FROM settings WHERE key = 'guests_paused'");
}

/**
 * What one server process hands the next on a restart (the lobbies, realtime.ts): written as it stops, taken once as the
 * next one starts, and only if that's within `maxAgeMs` (after a longer stop, nobody is waiting any more).
 */
export function handOver(value: unknown) {
  run(
    "INSERT INTO settings (key, value) VALUES ('handover', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    JSON.stringify({ at: Date.now(), value }),
  );
}

export function takeHandover<T>(maxAgeMs: number): T | null {
  const row = one<{ value: string }>("SELECT value FROM settings WHERE key = 'handover'");
  if (!row) return null;
  run("DELETE FROM settings WHERE key = 'handover'");
  const { at, value } = JSON.parse(row.value) as { at: number; value: T };
  return Date.now() - at <= maxAgeMs ? value : null;
}

/**
 * A random secret this installation makes the first time it's asked for and keeps from then on. The code is public;
 * what it seeds (e.g. which questions a day's challenge gets) mustn't be guessable from it.
 */
export function installationSecret(key: string): string {
  const existing = one<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  if (existing) return existing.value;
  run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', key, randomBytes(32).toString('base64url'));
  return one<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)!.value;
}
