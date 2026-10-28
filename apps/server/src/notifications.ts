import type { AppNotification } from '@quiz/shared';
import { all, one, run } from './db';
import { notifyUser } from './notify';

/** The newest this many are kept per player… */
const KEEP = 50;
/** …and none older than this. */
export const NOTIFICATION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

interface Row {
  id: number;
  icon: string;
  text: string;
  link: string | null;
  created_at: number;
  read_at: number | null;
}

const toNotification = (r: Row): AppNotification => ({
  id: r.id,
  icon: r.icon,
  text: r.text,
  link: r.link,
  createdAt: r.created_at,
  read: r.read_at !== null,
});

export const unreadNotifications = (userId: number) =>
  one<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId)!.n;

/** Unread notes of a player's that point to `link` (e.g. one challenge link's results). */
export const unreadAbout = (userId: number, link: string) =>
  one<{ n: number }>(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND link = ? AND read_at IS NULL',
    userId,
    link,
  )!.n;

/**
 * Something for a player to see whenever they're back: kept until read, and shown at once (a toast and the bell's
 * count) if they're on the page. Inside a transaction it goes out with the commit, like any notice. `replace`: it
 * stands for the unread ones about the same link (a link played by many is one note, not a page of them).
 */
export function notify(userId: number, note: { icon: string; text: string; link?: string | null; replace?: boolean }) {
  const now = Date.now();
  if (note.replace && note.link)
    run('DELETE FROM notifications WHERE user_id = ? AND link = ? AND read_at IS NULL', userId, note.link);
  const { lastInsertRowid } = run(
    'INSERT INTO notifications (user_id, icon, text, link, created_at) VALUES (?, ?, ?, ?, ?)',
    userId,
    note.icon,
    note.text,
    note.link ?? null,
    now,
  );
  run(
    `DELETE FROM notifications WHERE user_id = ? AND id NOT IN (
       SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?)`,
    userId,
    userId,
    KEEP,
  );
  const item = toNotification({
    id: Number(lastInsertRowid),
    icon: note.icon,
    text: note.text,
    link: note.link ?? null,
    created_at: now,
    read_at: null,
  });
  notifyUser(userId, 'notification', { item, unread: unreadNotifications(userId) });
}

/** The player's notes, newest first (with which ones they hadn't seen yet). */
export function listNotifications(userId: number): AppNotification[] {
  return all<Row>('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, KEEP).map(
    toNotification,
  );
}

/** Seen: the list was opened. */
export function markNotificationsRead(userId: number) {
  run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', Date.now(), userId);
}
