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
 * guests at once, so a free name is found on the first try or two. `room`: made to join a room from its link (a pupil
 * in a class), so it's kept only while it's here (purgeRoomGuests).
 */
export function createGuest({ room = false } = {}): number {
  for (let attempt = 0; attempt < 20; attempt++) {
    const username = `Гост_${randomInt(1_000_000, 10_000_000)}`;
    if (getUserByName(username)) continue;
    const now = Date.now();
    const { lastInsertRowid } = run(
      // Playing as a guest accepts the terms (each way in says so): terms_at keeps when.
      `INSERT INTO users (username, username_key, username_shape, password_hash, created_at, is_guest, room_guest_seen_at,
         terms_at)
       VALUES (?, ?, ?, '', ?, 1, ?, ?)`,
      username,
      usernameKey(username),
      nameShape(username),
      now,
      room ? now : null,
      now,
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

/**
 * A room's guest goes this long after it was last here: maintenance runs every 15 minutes and marks the ones still
 * here each time, so one is erased between 30 and 60 minutes after it left (what /teachers and the policy promise: within
 * an hour).
 */
export const ROOM_GUEST_MS = 45 * 60_000;

/**
 * A class keeps nothing: a guest made to join a room from its link is erased, with every answer, run and name it
 * played under, once it hasn't been here for ROOM_GUEST_MS — or at once when its session is gone (signed out). The
 * ones here now are marked as seen (so a restart, which drops every connection for a moment, never takes them). The
 * room's match stays in its host's history, with „Изтрит играч“ for each of them. Returns how many were erased.
 */
export async function purgeRoomGuests(now = Date.now()): Promise<number> {
  const guests = all<{ id: number; seen: number; signedIn: number }>(
    `SELECT id, room_guest_seen_at AS seen, EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id) AS signedIn
     FROM users WHERE room_guest_seen_at IS NOT NULL`,
  );
  const here = guests.filter((g) => presence(g.id) !== 'offline');
  if (here.length) {
    tx(() => {
      for (const g of here) run('UPDATE users SET room_guest_seen_at = ? WHERE id = ?', now, g.id);
    });
  }
  const gone = guests.filter((g) => presence(g.id) === 'offline' && (g.seen < now - ROOM_GUEST_MS || !g.signedIn));
  for (let i = 0; i < gone.length; i += BATCH) {
    tx(() => {
      for (const g of gone.slice(i, i + BATCH)) eraseAccount(g.id);
    });
    await yieldToMatches();
  }
  return gone.length;
}
