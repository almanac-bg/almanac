import {
  type ModerationAction,
  REPORT_REASONS,
  type ReportGroup,
  type ReportReason,
} from '@quiz/shared';
import { all, one, run, tx } from './db';
import { disconnectUser, notifyUser, removeFromPlay } from './notify';
import { getUser, getUserByName, toPublicUser, type UserRow, usernameKey } from './users';

// ─── Username filter ─────────────────────────────────────────────────────────

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a',
  ь: 'y', ю: 'yu', я: 'ya', ё: 'yo', ы: 'i', э: 'e',
};
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** Lowercase Latin letters only: Cyrillic transliterated, leetspeak undone, separators dropped, repeats collapsed. */
function skeleton(text: string): string {
  // Transliterate on composed text first (NFKD would split "й" into "и" + a combining breve),
  // then decompose to strip any remaining accents from Latin letters.
  const latin = [...text.normalize('NFC').toLowerCase()]
    .map((c) => TRANSLIT[c] ?? LEET[c] ?? c)
    .join('')
    .normalize('NFKD')
    .replace(/[^a-z]/g, '');
  return latin.replace(/(.)\1+/g, '$1');
}

// Substring matches (specific enough not to hit ordinary names).
const BLOCKED_STEMS = [
  'fuck', 'shit', 'cunt', 'nigg', 'fagot', 'whore', 'bitch', 'hitler', 'nazi', 'rapist', 'pedophil', 'pederas',
  'putk', 'pichk', 'kurv', 'shiban', 'dupedav', 'ebalo', 'ebach', 'ebat', 'ebem', 'mamkati', 'mamkamu',
];
// Short stems: only at the start or end of a word, so "Себастиан" or "Шухуй…" style names aren't caught by accident.
const BLOCKED_EDGES = ['huy', 'huj', 'pedal'];
// Names that could impersonate staff or the game itself.
const RESERVED_PREFIXES = ['admin', 'moderat', 'almanac', 'almanah', 'support', 'podrazhka', 'system', 'sistema', 'official', 'ofitsial'];

export function nameProblem(name: string): string | null {
  const whole = skeleton(name);
  if (BLOCKED_STEMS.some((s) => whole.includes(s))) return 'Името съдържа неподходящи думи.';
  const words = name.split(/[\s_.\-\d]+/).map(skeleton).filter(Boolean);
  if (words.some((w) => BLOCKED_EDGES.some((s) => w === s || w.startsWith(s) || w.endsWith(s)))) {
    return 'Името съдържа неподходящи думи.';
  }
  if (RESERVED_PREFIXES.some((p) => whole.startsWith(p))) return 'Това име е запазено.';
  return null;
}

// ─── Bans ────────────────────────────────────────────────────────────────────

const FOREVER = 8_640_000_000_000_000; // max Date

export function activeBan(user: Pick<UserRow, 'banned_until' | 'ban_reason'>): string | null {
  if (!user.banned_until || user.banned_until < Date.now()) return null;
  const until =
    user.banned_until >= FOREVER
      ? 'за постоянно'
      : `до ${new Date(user.banned_until).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', dateStyle: 'long', timeStyle: 'short' })}`;
  return `Профилът е спрян ${until}.${user.ban_reason ? ` Причина: ${user.ban_reason}` : ''}`;
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export type Result = { ok: true } | { ok: false; error: string };

const isReason = (r: unknown): r is ReportReason => REPORT_REASONS.some((x) => x.id === r);

export function fileReport(reporterId: number, username: string, reason: unknown, details: string): Result {
  const target = getUserByName(username);
  if (!target) return { ok: false, error: 'Няма такъв играч.' };
  if (target.id === reporterId) return { ok: false, error: 'Не можеш да докладваш себе си.' };
  if (!isReason(reason)) return { ok: false, error: 'Избери причина.' };
  const today = one<{ n: number }>(
    'SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > ?',
    reporterId,
    Date.now() - 24 * 60 * 60_000,
  )!.n;
  if (today >= 10) return { ok: false, error: 'Днес вече изпрати много доклади. Опитай утре.' };
  const text = details.trim().slice(0, 500) || null;
  const open = one<{ id: number }>(
    "SELECT id FROM reports WHERE reporter_id = ? AND target_id = ? AND status = 'open'",
    reporterId,
    target.id,
  );
  // One open report per pair: a second one just updates it.
  if (open) run('UPDATE reports SET reason = ?, details = ?, created_at = ? WHERE id = ?', reason, text, Date.now(), open.id);
  else {
    run(
      'INSERT INTO reports (reporter_id, target_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?)',
      reporterId,
      target.id,
      reason,
      text,
      Date.now(),
    );
  }
  return { ok: true };
}

export function openReports(): ReportGroup[] {
  const rows = all<{
    id: number;
    target_id: number;
    reason: ReportReason;
    details: string | null;
    created_at: number;
    reporter: string | null;
  }>(
    `SELECT r.id, r.target_id, r.reason, r.details, r.created_at, u.username AS reporter
     FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
     WHERE r.status = 'open' ORDER BY r.created_at`,
  );
  const groups = new Map<number, ReportGroup>();
  for (const r of rows) {
    let g = groups.get(r.target_id);
    if (!g) {
      const t = getUser(r.target_id)!;
      g = { target: { ...toPublicUser(t), bannedUntil: t.banned_until }, reports: [] };
      groups.set(r.target_id, g);
    }
    g.reports.push({ id: r.id, reason: r.reason, details: r.details, createdAt: r.created_at, reporter: r.reporter });
  }
  // Most-reported first.
  return [...groups.values()].sort((a, b) => b.reports.length - a.reports.length);
}

export const openReportCount = () => one<{ n: number }>("SELECT COUNT(DISTINCT target_id) AS n FROM reports WHERE status = 'open'")!.n;

/** Applies a moderator's decision and closes every open report about the player. */
export function resolveReports(adminId: number, targetId: number, decision: ModerationAction): Result {
  const target = getUser(targetId);
  if (!target) return { ok: false, error: 'Няма такъв играч.' };
  if (targetId === adminId && decision.action !== 'dismiss') return { ok: false, error: 'Не можеш да наказваш себе си.' };

  if (decision.action === 'rename') {
    const name = decision.username.trim();
    if (!/^[\p{L}\p{N}_.-]{3,20}$/u.test(name)) return { ok: false, error: 'Името трябва да е 3–20 букви, цифри, точка, тире или долна черта.' };
    const problem = nameProblem(name);
    if (problem) return { ok: false, error: problem };
    const taken = getUserByName(name);
    if (taken && taken.id !== targetId) return { ok: false, error: 'Това име вече е заето.' };
  }

  tx(() => {
    if (decision.action === 'rename') {
      run('UPDATE users SET username = ?, username_key = ? WHERE id = ?', decision.username.trim(), usernameKey(decision.username.trim()), targetId);
    } else if (decision.action === 'ban') {
      const until = decision.days === null ? FOREVER : Date.now() + decision.days * 24 * 60 * 60_000;
      run('UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ?', until, decision.reason.trim().slice(0, 200) || null, targetId);
      run('DELETE FROM sessions WHERE user_id = ?', targetId);
    }
    run(
      "UPDATE reports SET status = 'resolved', resolved_at = ?, resolved_by = ?, action = ? WHERE target_id = ? AND status = 'open'",
      Date.now(),
      adminId,
      decision.action,
      targetId,
    );
  });

  if (decision.action === 'rename') {
    notifyUser(targetId, 'notice', { kind: 'info', message: `Модератор смени името ти на „${decision.username.trim()}“.` });
    notifyUser(targetId, 'account:update');
  } else if (decision.action === 'ban') {
    removeFromPlay(targetId);
    disconnectUser(targetId);
  }
  return { ok: true };
}
