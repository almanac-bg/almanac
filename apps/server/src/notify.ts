import type { Presence, ServerToClientEvents } from '@quiz/shared';
import type { IO } from './game/io';

/**
 * Lets REST routes and background logic reach connected clients without importing the realtime layer
 * (which would be circular). `realtime.ts` wires both ends up on startup.
 */
let io: IO | null = null;
let presenceOf: (userId: number) => Presence = () => 'offline';
let friendsOf: (userId: number) => number[] = () => [];

export function setRealtime(server: IO, presence: (userId: number) => Presence, friends: (userId: number) => number[]) {
  io = server;
  presenceOf = presence;
  friendsOf = friends;
}

export const presence = (userId: number) => presenceOf(userId);

export function notifyUser<E extends keyof ServerToClientEvents>(
  userId: number,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) {
  (io?.to(`user:${userId}`).emit as ((...a: unknown[]) => void) | undefined)?.(event, ...args);
}

/** Drops every live connection of a user (e.g. after a password reset logs them out everywhere). */
export function disconnectUser(userId: number) {
  io?.in(`user:${userId}`).disconnectSockets(true);
}

/** Coalesced "your friends list changed" pings, so a flurry of presence changes sends one update. */
const pending = new Set<number>();
let flushTimer: NodeJS.Timeout | null = null;

export function friendsChanged(...userIds: number[]) {
  for (const id of userIds) pending.add(id);
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    const targets = new Set<number>();
    for (const id of pending) for (const friend of friendsOf(id)) targets.add(friend);
    pending.clear();
    for (const id of targets) notifyUser(id, 'friends:update');
  }, 300);
}
