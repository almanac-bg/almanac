import {
  MODERATION,
  MODERATION_BASES,
  type ModerationAction,
  type ModerationBasis,
  type PlayerCard,
  type PlayerSearchHit,
  REPORT_REASONS,
  type ReportGroup,
  type ReportReason,
  seasonKey,
} from '@quiz/shared';
import { alertModerators } from './alerts';
import { config } from './config';
import { all, one, run, tx } from './db';
import { banMail, sendMail } from './mailer';
import { laterDecision, logAction, logRow, markUndone, parseUndo, playerLog } from './modlog';
import { hasBlockedWords, nameShape, passesForTheGame } from './names';
import { notify } from './notifications';
import { disconnectUser, notifyUser, removeFromPlay } from './notify';
import { hideQuestion, unhideQuestion } from './questionReports';
import { reloadQuestionBank } from './questions';
import { hideSet } from './sets';
import { GUEST_NAME, getUser, getUserByName, nameTaken, toPublicUser, type UserRow, usernameKey } from './users';

/** Why a username can't be had (words nobody should see, or one that passes for the game's own), or null. */
export function nameProblem(name: string): string | null {
  if (hasBlockedWords(name)) return 'Името съдържа неподходящи думи.';
  if (passesForTheGame(name) || GUEST_NAME.test(name.trim())) return 'Това име е запазено.';
  return null;
}

// ─── Bans ────────────────────────────────────────────────────────────────────

const FOREVER = 8_640_000_000_000_000; // max Date

const basisLabel = (basis: string | null) => MODERATION_BASES.find((b) => b.id === basis)?.label ?? null;

/** What a stopped player is told when they try to sign in: until when, why, and where to appeal. */
export function activeBan(user: Pick<UserRow, 'banned_until' | 'ban_reason' | 'ban_basis'>): string | null {
  if (!user.banned_until || user.banned_until < Date.now()) return null;
  const until =
    user.banned_until >= FOREVER
      ? 'за постоянно'
      : `до ${new Date(user.banned_until).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', dateStyle: 'long', timeStyle: 'short' })}`;
  const basis = basisLabel(user.ban_basis);
  return [
    `Профилът е спрян ${until}.`,
    basis && `Основание: ${basis}.`,
    user.ban_reason && `Причина: ${user.ban_reason}`,
    `Ако смяташ, че е грешка, пиши на ${config.operator.email}.`,
  ]
    .filter(Boolean)
    .join(' ');
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
  if (open)
    run('UPDATE reports SET reason = ?, details = ?, created_at = ? WHERE id = ?', reason, text, Date.now(), open.id);
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
  const waiting = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM reports WHERE target_id = ? AND status = 'open'",
    target.id,
  )!.n;
  if (waiting >= MODERATION.alertAt)
    alertModerators(`player:${target.id}`, `${waiting} доклада за „${target.username}“`, [
      `Последният: ${REPORT_REASONS.find((r) => r.id === reason)!.label}${text ? ` — „${text}“` : ''}`,
    ]);
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

export const openReportCount = () =>
  one<{ n: number }>("SELECT COUNT(DISTINCT target_id) AS n FROM reports WHERE status = 'open'")!.n;

// ─── Decisions ───────────────────────────────────────────────────────────────
// Every one is logged (modlog.ts) with its basis and reason; those the player feels are told to them, with where to
// appeal. What can be undone keeps the state before.

const DAY = 24 * 60 * 60_000;

/** A basis from the list and a reason worth reading: what a decision about a player needs. */
function checkGrounds(basis: unknown, reason: string): string | null {
  if (!MODERATION_BASES.some((b) => b.id === basis)) return 'Избери основание.';
  if (reason.trim().length < MODERATION.reasonMin)
    return `Напиши причината (поне ${MODERATION.reasonMin} знака): играчът ще я прочете.`;
  return null;
}

/** Closes every open report about a player, as `action` decided. */
function closeReports(adminId: number, targetId: number, action: string) {
  run(
    "UPDATE reports SET status = 'resolved', resolved_at = ?, resolved_by = ?, action = ? WHERE target_id = ? AND status = 'open'",
    Date.now(),
    adminId,
    action,
    targetId,
  );
}

export function banPlayer(
  adminId: number,
  targetId: number,
  ban: { days: number | null; basis: ModerationBasis; reason: string; annul?: boolean },
): Result {
  const target = getUser(targetId);
  if (!target) return { ok: false, error: 'Няма такъв играч.' };
  if (targetId === adminId) return { ok: false, error: 'Не можеш да наказваш себе си.' };
  const problem = checkGrounds(ban.basis, ban.reason);
  if (problem) return { ok: false, error: problem };
  const reason = ban.reason.trim().slice(0, MODERATION.reasonMax);
  const until = ban.days === null ? FOREVER : Date.now() + ban.days * DAY;
  tx(() => {
    run(
      'UPDATE users SET banned_until = ?, ban_reason = ?, ban_basis = ? WHERE id = ?',
      until,
      reason,
      ban.basis,
      targetId,
    );
    run('DELETE FROM sessions WHERE user_id = ?', targetId);
    closeReports(adminId, targetId, 'ban');
    logAction({
      adminId,
      action: 'ban',
      userId: targetId,
      basis: ban.basis,
      reason: `${ban.days === null ? 'Завинаги' : `${ban.days} дни`}. ${reason}`,
      undo: { bannedUntil: target.banned_until, reason: target.ban_reason, basis: target.ban_basis },
    });
  });
  if (ban.annul) annulResults(adminId, targetId, reason);
  removeFromPlay(targetId);
  disconnectUser(targetId);
  if (target.email)
    sendMail(
      banMail(target.email, target.username, {
        until: ban.days === null ? null : until,
        basis: basisLabel(ban.basis)!,
        reason,
      }),
    );
  return { ok: true };
}

/** Lifts a ban now, or moves its end (`days` from now). */
export function changeBan(adminId: number, targetId: number, days: number | null, reason: string): Result {
  const target = getUser(targetId);
  if (!target) return { ok: false, error: 'Няма такъв играч.' };
  if (!target.banned_until || target.banned_until < Date.now()) return { ok: false, error: 'Профилът не е спрян.' };
  if (reason.trim().length < MODERATION.reasonMin)
    return { ok: false, error: `Напиши защо (поне ${MODERATION.reasonMin} знака).` };
  const until = days === null ? null : Date.now() + days * DAY;
  tx(() => {
    run(
      'UPDATE users SET banned_until = ?, ban_reason = CASE WHEN ? IS NULL THEN NULL ELSE ban_reason END, ban_basis = CASE WHEN ? IS NULL THEN NULL ELSE ban_basis END WHERE id = ?',
      until,
      until,
      until,
      targetId,
    );
    logAction({
      adminId,
      action: until === null ? 'unban' : 'ban_change',
      userId: targetId,
      reason: `${until === null ? '' : `Нов край след ${days} дни. `}${reason.trim().slice(0, MODERATION.reasonMax)}`,
      undo: { bannedUntil: target.banned_until, reason: target.ban_reason, basis: target.ban_basis },
    });
  });
  if (until === null)
    notify(targetId, { icon: '🕊️', text: 'Модератор свали спирането на профила ти: можеш да играеш отново.' });
  return { ok: true };
}

export function renamePlayer(
  adminId: number,
  targetId: number,
  rename: { username: string; basis: ModerationBasis; reason: string },
): Result {
  const target = getUser(targetId);
  if (!target) return { ok: false, error: 'Няма такъв играч.' };
  const problem = checkGrounds(rename.basis, rename.reason);
  if (problem) return { ok: false, error: problem };
  const name = rename.username.trim();
  if (!/^[\p{L}\p{N}_.-]{3,20}$/u.test(name))
    return { ok: false, error: 'Името трябва да е 3–20 букви, цифри, точка, тире или долна черта.' };
  const bad = nameProblem(name);
  if (bad) return { ok: false, error: bad };
  const taken = nameTaken(name, targetId);
  if (taken) return { ok: false, error: taken };
  const reason = rename.reason.trim().slice(0, MODERATION.reasonMax);
  tx(() => {
    setName(targetId, name);
    closeReports(adminId, targetId, 'rename');
    logAction({
      adminId,
      action: 'rename',
      userId: targetId,
      basis: rename.basis,
      reason: `„${target.username}“ → „${name}“. ${reason}`,
      undo: { username: target.username },
    });
  });
  afterRename(targetId);
  // A note that stays (a notice would be gone with the page): why the name changed, and where to appeal.
  notify(targetId, {
    icon: '✏️',
    text: `Модератор смени името ти на „${name}“. Основание: ${basisLabel(rename.basis)}. Причина: ${reason} Ако смяташ, че е грешка, пиши на ${config.operator.email}.`,
    link: '/settings',
  });
  return { ok: true };
}

function setName(userId: number, name: string) {
  run(
    'UPDATE users SET username = ?, username_key = ?, username_shape = ? WHERE id = ?',
    name,
    usernameKey(name),
    nameShape(name),
    userId,
  );
}

function afterRename(userId: number) {
  reloadQuestionBank(); // their approved questions show the new name
  notifyUser(userId, 'account:update');
}

interface AnnulUndo {
  ratings: { season: string; mode: string; rating: number; peak: number; games: number; wins: number }[];
  daily: { day: string; own_set: number | null }[];
  evening: { day: string; placement: number; score: number; players: number }[];
}

/**
 * Takes a cheater's results off the boards: this season's ratings start over, this season's dailies leave the day's
 * board, and their evening places go. The rows are kept in the log, for an undo.
 */
export function annulResults(adminId: number, targetId: number, reason: string): Result {
  if (!getUser(targetId)) return { ok: false, error: 'Няма такъв играч.' };
  const season = seasonKey();
  tx(() => {
    const undo: AnnulUndo = {
      ratings: all(
        'SELECT season, mode, rating, peak, games, wins FROM season_ratings WHERE user_id = ? AND season = ?',
        targetId,
        season,
      ),
      // As they were (null: as the account is, a guest's off the board), to put back exactly.
      daily: all<{ day: string; own_set: number | null }>(
        'SELECT day, own_set FROM daily_results WHERE user_id = ? AND day >= ? AND own_set IS NOT 1',
        targetId,
        `${season}-01`,
      ),
      evening: all('SELECT day, placement, score, players FROM evening_results WHERE user_id = ?', targetId),
    };
    run('DELETE FROM season_ratings WHERE user_id = ? AND season = ?', targetId, season);
    run('UPDATE daily_results SET own_set = 1 WHERE user_id = ? AND day >= ?', targetId, `${season}-01`);
    run('DELETE FROM evening_results WHERE user_id = ?', targetId);
    logAction({
      adminId,
      action: 'annul',
      userId: targetId,
      reason: reason.trim().slice(0, MODERATION.reasonMax),
      undo,
    });
  });
  return { ok: true };
}

export function dismissReports(adminId: number, targetId: number): Result {
  if (!getUser(targetId)) return { ok: false, error: 'Няма такъв играч.' };
  tx(() => {
    closeReports(adminId, targetId, 'dismiss');
    logAction({ adminId, action: 'dismiss_reports', userId: targetId });
  });
  return { ok: true };
}

/** A report's decision, from the reports queue. */
export function resolveReports(adminId: number, targetId: number, decision: ModerationAction): Result {
  if (decision.action === 'dismiss') return dismissReports(adminId, targetId);
  if (decision.action === 'rename') return renamePlayer(adminId, targetId, decision);
  return banPlayer(adminId, targetId, decision);
}

/** A group's name that broke the rules: it becomes „Група N“, and its owner hears why. */
export function renameGroupByModerator(
  adminId: number,
  groupId: number,
  basis: ModerationBasis,
  reason: string,
): Result {
  const group = one<{ name: string; owner_id: number | null }>(
    'SELECT name, owner_id FROM player_groups WHERE id = ?',
    groupId,
  );
  if (!group) return { ok: false, error: 'Няма такава група.' };
  const problem = checkGrounds(basis, reason);
  if (problem) return { ok: false, error: problem };
  const name = `Група ${groupId}`;
  tx(() => {
    run('UPDATE player_groups SET name = ? WHERE id = ?', name, groupId);
    logAction({
      adminId,
      action: 'rename_group',
      userId: group.owner_id,
      target: String(groupId),
      basis,
      reason: `„${group.name}“ → „${name}“. ${reason.trim().slice(0, MODERATION.reasonMax)}`,
      undo: { name: group.name },
    });
  });
  if (group.owner_id)
    notify(group.owner_id, {
      icon: '✏️',
      text: `Модератор смени името на групата ти „${group.name}“ на „${name}“. Причина: ${reason.trim()} Можеш да ѝ дадеш друго име.`,
      link: `/groups/${groupId}`,
    });
  return { ok: true };
}

// ─── Players, for moderators ─────────────────────────────────────────────────

const toHit = (u: UserRow): PlayerSearchHit => ({
  user: toPublicUser(u),
  isGuest: u.is_guest === 1,
  banned: !!u.banned_until && u.banned_until > Date.now(),
  createdAt: u.created_at,
});

/** Players by (part of) their name: exact first, then those starting with it, then any containing it. */
export function searchPlayers(query: string): PlayerSearchHit[] {
  const key = usernameKey(query.trim());
  if (key.length < 2) return [];
  // `!` escapes LIKE's own wildcards, should a name contain them.
  const like = `%${key.replace(/[%_!]/g, (c) => `!${c}`)}%`;
  return all<UserRow>(
    `SELECT * FROM users WHERE username_key LIKE ? ESCAPE '!'
     ORDER BY username_key = ? DESC, username_key LIKE ? DESC, username_key LIMIT 20`,
    like,
    key,
    `${key}%`,
  ).map(toHit);
}

export function playerCard(id: number): PlayerCard | null {
  const u = getUser(id);
  if (!u) return null;
  const count = (sql: string, ...args: (string | number)[]) => one<{ n: number }>(sql, ...args)!.n;
  const banned = !!u.banned_until && u.banned_until > Date.now();
  return {
    user: {
      ...toPublicUser(u),
      isGuest: u.is_guest === 1,
      createdAt: u.created_at,
      lastSeenAt: u.last_seen_at,
      hasEmail: !!u.email,
    },
    ban: banned
      ? { until: u.banned_until!, basis: (u.ban_basis as ModerationBasis | null) ?? null, reason: u.ban_reason }
      : null,
    gamesPlayed: u.games_played,
    reports: {
      open: count("SELECT COUNT(*) AS n FROM reports WHERE target_id = ? AND status = 'open'", id),
      resolved: count("SELECT COUNT(*) AS n FROM reports WHERE target_id = ? AND status != 'open'", id),
      filed: count('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ?', id),
    },
    submissions: {
      pending: count("SELECT COUNT(*) AS n FROM question_submissions WHERE user_id = ? AND status = 'pending'", id),
      approved: count("SELECT COUNT(*) AS n FROM question_submissions WHERE user_id = ? AND status = 'approved'", id),
      rejected: count("SELECT COUNT(*) AS n FROM question_submissions WHERE user_id = ? AND status = 'rejected'", id),
    },
    groups: all<{ id: number; name: string; members: number }>(
      `SELECT g.id, g.name, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members
       FROM player_groups g WHERE g.owner_id = ? ORDER BY g.id`,
      id,
    ),
    sets: all<{ code: string; name: string; hidden: number }>(
      'SELECT code, name, hidden FROM question_sets WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 30',
      id,
    ).map((r) => ({ code: r.code, name: r.name, hidden: r.hidden === 1 })),
    log: playerLog(id),
  };
}

// ─── Undo ────────────────────────────────────────────────────────────────────

/** Takes back a logged decision, as far as it can be (a name taken since can't be given back). Logged as undone. */
export function undoAction(adminId: number, logId: number): Result {
  const row = logRow(logId);
  if (!row) return { ok: false, error: 'Няма такъв запис.' };
  if (row.undone_at !== null) return { ok: false, error: 'Вече е отменено.' };
  const undo = parseUndo<Record<string, unknown>>(row);
  if (!undo) return { ok: false, error: 'Това не може да се отмени.' };
  if (laterDecision(row)) return { ok: false, error: 'По-късно решение промени това — отмени първо него.' };
  const userId = row.target_user_id;
  switch (row.action) {
    case 'ban':
    case 'unban':
    case 'ban_change': {
      if (userId === null) return { ok: false, error: 'Играчът вече го няма.' };
      run(
        'UPDATE users SET banned_until = ?, ban_reason = ?, ban_basis = ? WHERE id = ?',
        (undo.bannedUntil as number | null) ?? null,
        (undo.reason as string | null) ?? null,
        (undo.basis as string | null) ?? null,
        userId,
      );
      // Banned again by the undo: off the game at once.
      if (row.action !== 'ban' && undo.bannedUntil && (undo.bannedUntil as number) > Date.now()) {
        run('DELETE FROM sessions WHERE user_id = ?', userId);
        removeFromPlay(userId);
        disconnectUser(userId);
      }
      break;
    }
    case 'rename': {
      if (userId === null) return { ok: false, error: 'Играчът вече го няма.' };
      const old = String(undo.username);
      const taken = nameTaken(old, userId);
      if (taken) return { ok: false, error: `„${old}“ вече е заето.` };
      setName(userId, old);
      afterRename(userId);
      notify(userId, { icon: '✏️', text: `Модератор върна името ти „${old}“.` });
      break;
    }
    case 'annul': {
      if (userId === null) return { ok: false, error: 'Играчът вече го няма.' };
      const a = undo as unknown as AnnulUndo;
      tx(() => {
        for (const r of a.ratings)
          run(
            `INSERT OR REPLACE INTO season_ratings (user_id, season, mode, rating, peak, games, wins)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            userId,
            r.season,
            r.mode,
            r.rating,
            r.peak,
            r.games,
            r.wins,
          );
        for (const d of a.daily)
          run('UPDATE daily_results SET own_set = ? WHERE user_id = ? AND day = ?', d.own_set, userId, d.day);
        for (const e of a.evening)
          run(
            'INSERT OR IGNORE INTO evening_results (day, user_id, placement, score, players) VALUES (?, ?, ?, ?, ?)',
            e.day,
            userId,
            e.placement,
            e.score,
            e.players,
          );
      });
      break;
    }
    case 'rename_group':
      run('UPDATE player_groups SET name = ? WHERE id = ?', String(undo.name), Number(row.target));
      break;
    case 'hide_question':
    case 'auto_hide_question': {
      const done = unhideQuestion(String(row.target));
      if (!done.ok) return done;
      break;
    }
    case 'unhide_question':
      hideQuestion(adminId, String(row.target));
      break;
    case 'hide_set':
    case 'unhide_set':
      hideSet(String(row.target), row.action === 'unhide_set');
      break;
    default:
      return { ok: false, error: 'Това не може да се отмени.' };
  }
  markUndone(logId, adminId);
  return { ok: true };
}
