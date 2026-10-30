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
  undo_reason: string | null;
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

export function markUndone(id: number, adminId: number, reason: string) {
  run(
    'UPDATE moderation_log SET undone_at = ?, undone_by = ?, undo_reason = ? WHERE id = ?',
    Date.now(),
    adminId,
    reason,
    id,
  );
}

/**
 * Decisions that set the same thing (a player's ban, their name, their results; a question's, a set's place in play; a
 * group's name). Undoing one puts back the state before it, so only the newest still standing can be undone: an older
 * one would override what was decided since (undoing a week's ban lifted a later permanent one).
 */
const FAMILIES: ModerationLogAction[][] = [
  ['ban', 'unban', 'ban_change'],
  ['rename'],
  ['annul'],
  ['hide_question', 'auto_hide_question', 'unhide_question', 'fix_question', 'dismiss_flags'],
  ['hide_set', 'unhide_set'],
  ['rename_group'],
];
const ABOUT_PLAYER = new Set<ModerationLogAction>(['ban', 'unban', 'ban_change', 'rename', 'annul']);

/** The later decision, still standing, that undoing this one would override; undefined when there's none. */
export function laterDecision(r: LogRow): LogRow | undefined {
  const family = FAMILIES.find((f) => f.includes(r.action)) ?? [r.action];
  const byPlayer = ABOUT_PLAYER.has(r.action);
  const subject = byPlayer ? r.target_user_id : r.target;
  if (subject === null) return undefined;
  return one<LogRow>(
    `SELECT * FROM moderation_log WHERE ${byPlayer ? 'target_user_id' : 'target'} = ? AND id > ? AND undone_at IS NULL
       AND action IN (${family.map(() => '?').join(', ')}) ORDER BY id LIMIT 1`,
    subject,
    r.id,
    ...family,
  );
}

/** Where a moderator sees what an entry was about. */
function linkOf(r: LogRow): string | null {
  return (r.action === 'hide_set' || r.action === 'unhide_set') && r.target ? `/sets/shared/${r.target}` : null;
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
    undoReason: r.undo_reason,
    canUndo: !!r.undo && r.undone_at === null && !laterDecision(r),
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
