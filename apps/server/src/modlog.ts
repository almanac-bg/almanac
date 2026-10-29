import type { ModerationBasis, ModerationLogAction, ModerationLogEntry } from '@quiz/shared';
import { all, one, run } from './db';
import { getUser, toPublicUser, type UserRow } from './users';

/**
 * The moderation log: every decision a moderator makes (and the game's own, such as a question its players' flags
 * hid), with its basis and reason — for the other moderators, for the player's appeal, and for undoing it (`undo`:
 * the state before, as the action needs it; none when it can't be undone). See moderation.ts → undoAction.
 */

interface LogRow {
  id: number;
  admin_id: number | null;
  action: ModerationLogAction;
  target_user_id: number | null;
  target: string | null;
  basis: ModerationBasis | null;
  reason: string | null;
  undo: string | null;
  created_at: number;
  undone_at: number | null;
  undone_by: number | null;
}

export function logAction(entry: {
  adminId: number | null;
  action: ModerationLogAction;
  userId?: number | null;
  /** What it was about besides a player: a question's id, a set's code, a group's id. */
  target?: string | null;
  basis?: ModerationBasis | null;
  reason?: string | null;
  undo?: unknown;
}): number {
  return Number(
    run(
      `INSERT INTO moderation_log (admin_id, action, target_user_id, target, basis, reason, undo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.adminId,
      entry.action,
      entry.userId ?? null,
      entry.target ?? null,
      entry.basis ?? null,
      entry.reason ?? null,
      entry.undo === undefined ? null : JSON.stringify(entry.undo),
      Date.now(),
    ).lastInsertRowid,
  );
}

export const logRow = (id: number) => one<LogRow>('SELECT * FROM moderation_log WHERE id = ?', id);

export const parseUndo = <T>(row: LogRow): T | null => (row.undo ? (JSON.parse(row.undo) as T) : null);

export function markUndone(id: number, adminId: number) {
  run('UPDATE moderation_log SET undone_at = ?, undone_by = ? WHERE id = ?', Date.now(), adminId, id);
}

/** Where a moderator sees what an entry was about. */
function linkOf(r: LogRow): string | null {
  if (r.action === 'hide_set' || r.action === 'unhide_set') return r.target && `/sets/shared/${r.target}`;
  if (r.target_user_id && !r.target) return null;
  return null;
}

function toEntry(r: LogRow, names: Map<number, UserRow | undefined>): ModerationLogEntry {
  const name = (id: number | null) => (id === null ? null : (names.get(id)?.username ?? 'изтрит модератор'));
  const user = r.target_user_id === null ? undefined : names.get(r.target_user_id);
  return {
    id: r.id,
    action: r.action,
    admin: name(r.admin_id),
    user: user ? toPublicUser(user) : null,
    target: r.target,
    link: linkOf(r),
    basis: r.basis,
    reason: r.reason,
    createdAt: r.created_at,
    undoneAt: r.undone_at,
    undoneBy: name(r.undone_by),
    canUndo: !!r.undo && r.undone_at === null,
  };
}

function entries(rows: LogRow[]): ModerationLogEntry[] {
  const ids = new Set<number>();
  for (const r of rows) for (const id of [r.admin_id, r.target_user_id, r.undone_by]) if (id !== null) ids.add(id);
  const names = new Map([...ids].map((id) => [id, getUser(id)]));
  return rows.map((r) => toEntry(r, names));
}

/** The latest entries, newest first (`before`: an entry's id, for the next page). */
export function moderationLog(limit = 50, before: number | null = null): ModerationLogEntry[] {
  return entries(
    all<LogRow>(
      `SELECT * FROM moderation_log ${before === null ? '' : 'WHERE id < ?'} ORDER BY id DESC LIMIT ?`,
      ...(before === null ? [limit] : [before, limit]),
    ),
  );
}

/** A player's entries, newest first. */
export const playerLog = (userId: number, limit = 30) =>
  entries(all<LogRow>('SELECT * FROM moderation_log WHERE target_user_id = ? ORDER BY id DESC LIMIT ?', userId, limit));
