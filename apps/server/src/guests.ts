import { randomInt } from 'node:crypto';
import { setImmediate as yieldToMatches } from 'node:timers/promises';
import { eraseAccount } from './account';
import { all, run, tx } from './db';
import { nameShape } from './names';
import { presence } from './notify';
import { getUserByName, usernameKey } from './users';

/** For what needs a real account: friends, rooms of your own, writing questions, reports, email. */
export const ACCOUNT_ONLY = 'Това е за играчи с профил — запази прогреса си с име и парола. Отнема 10 секунди.';

/**
 * A guest account: plays like any other, without a password until it's claimed. Seven digits: room for millions of
 * guests at once, so a free name is found on the first try or two.
 */
export function createGuest(): number {
  for (let attempt = 0; attempt < 20; attempt++) {
    const username = `Гост_${randomInt(1_000_000, 10_000_000)}`;
    if (getUserByName(username)) continue;
    const { lastInsertRowid } = run(
      `INSERT INTO users (username, username_key, username_shape, password_hash, created_at, is_guest)
       VALUES (?, ?, ?, '', ?, 1)`,
      username,
      usernameKey(username),
      nameShape(username),
      Date.now(),
    );
    return Number(lastInsertRowid);
  }
  throw new Error('No free guest name');
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Looked at per query; erased in one transaction, as many as fit in BATCH_MS. */
const BATCH = 50;
/** A batch never holds the thread longer than this (a couple of frames): then running matches go on. */
const BATCH_MS = 10;
/** Per maintenance run, at most: a launch-day wave is cleared over a few runs, never in one long one. */
const PER_RUN = 5_000;

/**
 * Guests at least a day old that nobody will play as again: one without a session can never be signed in to (no
 * password), and one that hasn't played a single question in its first day was a visit, not a player (or a script
 * making guests). They're erased with their stats — matches they played stay in other players' histories, without the
 * name. A batch at a time, with running matches going on in between; someone online right now is left for a later run.
 * Returns how many were erased.
 */
export async function purgeGuests(now = Date.now(), limit = PER_RUN): Promise<number> {
  let erased = 0;
  // Where the last batch stopped: one looked at and left alone (online) isn't fetched again.
  let after = { createdAt: -1, id: 0 };
  while (erased < limit) {
    const batch = all<{ id: number; created_at: number }>(
      `SELECT id, created_at FROM users WHERE is_guest = 1 AND (created_at, id) > (?, ?) AND created_at < ?
       AND (questions_answered = 0 OR NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id))
       ORDER BY created_at, id LIMIT ?`,
      after.createdAt,
      after.id,
      now - DAY_MS,
      Math.min(BATCH, limit - erased),
    );
    if (!batch.length) break;
    const deadline = performance.now() + BATCH_MS;
    tx(() => {
      for (const { id, created_at } of batch) {
        after = { createdAt: created_at, id };
        if (presence(id) !== 'offline') continue;
        eraseAccount(id);
        erased++;
        if (performance.now() > deadline) break;
      }
    });
    await yieldToMatches();
  }
  return erased;
}
