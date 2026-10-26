import type { Presence } from '@quiz/shared';

/** Where a friend is right now, in words and as a dot's colour: the same on the friends page and in a room's invites. */
export const PRESENCE: Record<Presence, { label: string; color: string }> = {
  online: { label: 'Онлайн', color: '#34d399' },
  queue: { label: 'Търси мач', color: '#fbbf24' },
  room: { label: 'В стая', color: '#e879f9' },
  game: { label: 'В мач', color: '#a78bfa' },
  offline: { label: 'Офлайн', color: '#64748b' },
};
