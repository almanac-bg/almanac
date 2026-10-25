import type { FriendEntry, Friendship, FriendsResponse } from '@quiz/shared';
import { all, one, run } from './db';
import { presence } from './notify';
import { getUserByName, toPublicUser, type UserRow } from './users';

const MAX_FRIENDS = 200;
/** Requests waiting for an answer; enough for any real use, too few for spamming strangers. */
const MAX_PENDING_OUTGOING = 20;

const pair = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);

interface Row {
  user_a: number;
  user_b: number;
  requested_by: number;
  status: 'pending' | 'accepted';
  created_at: number;
  accepted_at: number | null;
}

function row(a: number, b: number) {
  const [x, y] = pair(a, b);
  return one<Row>('SELECT * FROM friendships WHERE user_a = ? AND user_b = ?', x, y);
}

export function friendship(me: number, other: number): Friendship {
  if (me === other) return 'self';
  const r = row(me, other);
  if (!r) return 'none';
  if (r.status === 'accepted') return 'friends';
  return r.requested_by === me ? 'outgoing' : 'incoming';
}

export const areFriends = (a: number, b: number) => friendship(a, b) === 'friends';

export function friendIds(userId: number): number[] {
  return all<{ id: number }>(
    `SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS id FROM friendships
     WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'`,
    userId,
    userId,
    userId,
  ).map((r) => r.id);
}

export function incomingRequests(userId: number): number {
  return (
    one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM friendships WHERE (user_a = ? OR user_b = ?) AND status = 'pending' AND requested_by != ?",
      userId,
      userId,
      userId,
    )?.n ?? 0
  );
}

const PRESENCE_ORDER = { game: 0, room: 1, queue: 2, online: 3, offline: 4 } as const;

export function listFriends(userId: number): FriendsResponse {
  const rows = all<UserRow & { requested_by: number; status: Row['status']; since_created: number; accepted_at: number | null }>(
    `SELECT u.*, f.requested_by, f.status, f.created_at AS since_created, f.accepted_at
     FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
     WHERE f.user_a = ? OR f.user_b = ?`,
    userId,
    userId,
    userId,
  );

  const entry = (r: (typeof rows)[number]): FriendEntry => ({
    user: toPublicUser(r),
    presence: r.status === 'accepted' ? presence(r.id) : 'offline',
    since: r.accepted_at ?? r.since_created,
  });
  const friends = rows.filter((r) => r.status === 'accepted').map(entry);
  friends.sort((a, b) => PRESENCE_ORDER[a.presence] - PRESENCE_ORDER[b.presence] || b.user.level - a.user.level);
  return {
    friends,
    incoming: rows.filter((r) => r.status === 'pending' && r.requested_by !== userId).map(entry),
    outgoing: rows.filter((r) => r.status === 'pending' && r.requested_by === userId).map(entry),
  };
}

export type FriendResult = { ok: true; otherId: number; accepted: boolean } | { ok: false; error: string };

/** Sends a request — or accepts one if the other player already asked. */
export function requestFriend(userId: number, username: string): FriendResult {
  const other = getUserByName(username.trim());
  // Guests (no account yet) can't be added: they may be gone tomorrow.
  if (!other || other.is_guest) return { ok: false, error: 'Няма играч с това име.' };
  if (other.id === userId) return { ok: false, error: 'Не можеш да добавиш себе си.' };
  const state = friendship(userId, other.id);
  if (state === 'friends') return { ok: false, error: 'Вече сте приятели.' };
  if (state === 'outgoing') return { ok: false, error: 'Поканата вече е изпратена.' };
  if (state === 'incoming') return acceptFriend(userId, other.id);
  if (friendIds(userId).length >= MAX_FRIENDS) return { ok: false, error: `Можеш да имаш до ${MAX_FRIENDS} приятели.` };
  const pending = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM friendships WHERE (user_a = ? OR user_b = ?) AND status = 'pending' AND requested_by = ?",
    userId,
    userId,
    userId,
  )!.n;
  if (pending >= MAX_PENDING_OUTGOING) {
    return { ok: false, error: `Имаш ${pending} неотговорени покани. Изчакай някои от тях да бъдат приети.` };
  }
  const [a, b] = pair(userId, other.id);
  run(
    "INSERT INTO friendships (user_a, user_b, requested_by, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
    a,
    b,
    userId,
    Date.now(),
  );
  return { ok: true, otherId: other.id, accepted: false };
}

export function acceptFriend(userId: number, otherId: number): FriendResult {
  if (friendship(userId, otherId) !== 'incoming') return { ok: false, error: 'Няма такава покана.' };
  const [a, b] = pair(userId, otherId);
  run("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_a = ? AND user_b = ?", Date.now(), a, b);
  return { ok: true, otherId, accepted: true };
}

/** Removes a friend, declines an incoming request or cancels an outgoing one. */
export function removeFriend(userId: number, otherId: number): boolean {
  const [a, b] = pair(userId, otherId);
  return Number(run('DELETE FROM friendships WHERE user_a = ? AND user_b = ?', a, b).changes) > 0;
}
