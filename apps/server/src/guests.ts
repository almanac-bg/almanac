import { randomInt } from 'node:crypto';
import { eraseAccount } from './account';
import { all, run } from './db';
import { getUserByName, usernameKey } from './users';

/** For what needs a real account: friends, rooms of your own, writing questions, reports, email. */
export const ACCOUNT_ONLY = 'Това е за играчи с профил — запази прогреса си с име и парола. Отнема 10 секунди.';

/** A guest account: plays like any other, without a password until it's claimed. */
export function createGuest(): number {
  for (let attempt = 0; attempt < 20; attempt++) {
    const username = `Гост_${randomInt(100_000, 1_000_000)}`;
    if (getUserByName(username)) continue;
    const { lastInsertRowid } = run(
      "INSERT INTO users (username, username_key, password_hash, created_at, is_guest) VALUES (?, ?, '', ?, 1)",
      username,
      usernameKey(username),
      Date.now(),
    );
    return Number(lastInsertRowid);
  }
  throw new Error('No free guest name');
}

/** Per maintenance run: erasing one takes up to ~10 ms, and a launch-day spike would all expire on the same day. */
const PURGE_BATCH = 100;

/**
 * A guest without a session can never be signed in to again (no password): it's erased once at least a day old, with
 * its stats — but the matches it played stay in other players' histories, without the name. A batch at a time, so a
 * big wave of them never stalls running matches; the rest go in the next runs.
 */
export function purgeGuests(now = Date.now()): number {
  const ids = all<{ id: number }>(
    `SELECT id FROM users WHERE is_guest = 1 AND created_at < ?
     AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id) LIMIT ?`,
    now - 24 * 60 * 60 * 1000,
    PURGE_BATCH,
  );
  for (const { id } of ids) eraseAccount(id);
  return ids.length;
}
