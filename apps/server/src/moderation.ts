import {
  BRAND,
  type CaseDecision,
  MODERATION,
  MODERATION_BASES,
  type ModerationBasis,
  type PlayerCard,
  type PlayerSearchHit,
  REPORT_REASONS,
  REPORT_REASONS_FOR,
  type ReportCase,
  type ReportCases,
  type Reporter,
  type ReportReason,
  type ReportSubjectKind,
  seasonKey,
  USERNAME,
} from '@quiz/shared';
import { bannedBefore } from './account';
import { alertModerators } from './alerts';
import { config } from './config';
import { all, one, run, tx } from './db';
import { longDateTime } from './mailer';
import { laterDecision, logAction, logRow, markUndone, parseUndo, playerLog } from './modlog';
import { hasBlockedWords, mixesScripts, nameShape, passesForTheGame } from './names';
import { disconnectUser, notifyUser, removeFromPlay } from './notify';
import { hideQuestion, unhideQuestion } from './questionReports';
import { reloadQuestionBank } from './questions';
import { copiesOf, hideSet } from './sets';
import {
  basisLabel,
  confirmNotice,
  HUMAN,
  type Outcome,
  sentence,
  tellPlayer,
  tellReporters,
  tellReversal,
} from './statements';
import { ratesPeople } from './trust';
import {
  GUEST_NAME,
  getUser,
  getUserByName,
  isAdmin,
  isOwner,
  nameTaken,
  toPublicUser,
  type UserRow,
  usernameKey,
} from './users';

/** Why a username can't be had (words nobody should see, or one that passes for the game's own), or null. */
export function nameProblem(name: string): string | null {
  if (hasBlockedWords(name, { username: true })) return 'Името съдържа неподходящи думи.';
  if (passesForTheGame(name) || GUEST_NAME.test(name.trim())) return 'Това име е запазено.';
  if (mixesScripts(name)) return 'Името смесва латиница и кирилица (или гръцки) в една дума — напиши я с едната.';
  return null;
}

// ─── Bans ────────────────────────────────────────────────────────────────────

const FOREVER = 8_640_000_000_000_000; // max Date

/**
 * What a stopped player is told when they try to sign in: until when, on what basis and why, that a person decided,
 * where to appeal, and how to get their data or the account deleted (Settings is out of reach).
 */
export function activeBan(user: Pick<UserRow, 'banned_until' | 'ban_reason' | 'ban_basis'>): string | null {
  if (!user.banned_until || user.banned_until < Date.now()) return null;
  const basis = basisLabel(user.ban_basis);
  return [
    `Профилът е спрян ${banEnd(user.banned_until)}.`,
    basis && `Основание: ${basis}.`,
    user.ban_reason && `Причина: ${sentence(user.ban_reason)}`,
    HUMAN,
    `Ако смяташ, че е грешка, пиши на ${config.operator.email} до 6 месеца; можеш да се обърнеш и към орган за извънсъдебно решаване на спорове или към съда.`,
    'На същия адрес можеш да поискаш данните си или изтриване на профила.',
  ]
    .filter(Boolean)
    .join(' ');
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export type Result = { ok: true } | { ok: false; error: string; status?: number };

/** What a report is about: a player, a group or a set, whose it is, and what to call it. */
export interface Subject {
  kind: ReportSubjectKind;
  /** The player's or the group's id, the set's code. */
  id: string;
  /** The player, or whose the group or the set is. */
  owner: number;
  /** Its name as the reporter saw it (a player's, a group's, a set's). */
  label: string;
}

/** The open reports about one thing, in SQL: a player's by `target_id`, a group's or a set's by `subject_id`. */
function aboutThing(kind: ReportSubjectKind, id: string): [string, (string | number)[]] {
  return kind === 'player'
    ? ["subject_kind = 'player' AND target_id = ?", [Number(id)]]
    : ['subject_kind = ? AND subject_id = ?', [kind, id]];
}

const isReason = (r: unknown): r is ReportReason => REPORT_REASONS.some((x) => x.id === r);
const reasonLabel = (r: ReportReason) => REPORT_REASONS.find((x) => x.id === r)!.label;

/**
 * A report: one open per reporter and thing (a second one replaces it: the latest word counts), ten a day per
 * reporter. Illegal content brings the moderators a mail at once, anything else at MODERATION.alertAt reports; its
 * sender gets a receipt.
 */
export function fileReport(reporterId: number, subject: Subject, reason: unknown, details: string): Result {
  const reporter = getUser(reporterId);
  if (reporter?.reports_stopped_until && reporter.reports_stopped_until > Date.now())
    return {
      ok: false,
      error: `Модератор спря докладите ти до ${longDateTime(reporter.reports_stopped_until)}: много от тях бяха без основание. Ако е грешка, пиши на ${config.operator.email}.`,
    };
  if (subject.owner === reporterId)
    return { ok: false, error: subject.kind === 'player' ? 'Не можеш да докладваш себе си.' : 'Това е твое.' };
  if (!isReason(reason) || !REPORT_REASONS_FOR[subject.kind].includes(reason))
    return { ok: false, error: 'Избери причина.' };
  const today = one<{ n: number }>(
    'SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > ?',
    reporterId,
    Date.now() - 24 * 60 * 60_000,
  )!.n;
  if (today >= 10) return { ok: false, error: 'Днес вече изпрати много доклади. Опитай утре.' };
  const text = details.trim().slice(0, 500) || null;
  const [where, args] = aboutThing(subject.kind, subject.id);
  const open = one<{ id: number }>(
    `SELECT id FROM reports WHERE reporter_id = ? AND status = 'open' AND ${where}`,
    reporterId,
    ...args,
  );
  if (open)
    run('UPDATE reports SET reason = ?, details = ?, created_at = ? WHERE id = ?', reason, text, Date.now(), open.id);
  else {
    run(
      `INSERT INTO reports (reporter_id, target_id, subject_kind, subject_id, reason, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      reporterId,
      subject.owner,
      subject.kind,
      subject.kind === 'player' ? null : subject.id,
      reason,
      text,
      Date.now(),
    );
  }
  const waiting = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM reports WHERE status = 'open' AND ${where}`,
    ...args,
  )!.n;
  const what = `${KIND_WORDS[subject.kind]} „${subject.label}“`;
  const last = `Последният: ${reasonLabel(reason)}${text ? ` — „${text}“` : ''}`;
  // About staff: the owner's to hear, as to decide.
  const ownerOnly = !!getUser(subject.owner)?.is_admin;
  if (reason === 'illegal') {
    // At once from a reporter whose word has weight (a player for a while, or with a report upheld before); from a new
    // account, one mail an hour for all of them — a few throwaway accounts mustn't flood the moderators' inboxes and
    // bury a real notice (the 31 October review, MOD-3). Either way the case is first in the queue.
    if (reporter && (ratesPeople(reporter) || upheldReports(reporterId) > 0))
      alertModerators(`case:${subject.kind}:${subject.id}:illegal`, `Незаконно съдържание: ${what}`, [last], {
        ownerOnly,
      });
    else {
      const fresh = one<{ n: number }>(
        "SELECT COUNT(*) AS n FROM reports WHERE status = 'open' AND reason = 'illegal'",
      )!.n;
      alertModerators(
        'illegal:new-accounts',
        'Нови сигнали за незаконно съдържание',
        [`Отворени сигнали за незаконно съдържание: ${fresh}. Най-новите са от нови профили — първи са в опашката.`],
        { per: 'hour' },
      );
    }
    confirmNotice(reporterId, subject.label);
  } else if (waiting >= MODERATION.alertAt)
    alertModerators(`case:${subject.kind}:${subject.id}`, `${waiting} доклада за ${what}`, [last], { ownerOnly });
  return { ok: true };
}

const KIND_WORDS: Record<ReportSubjectKind, string> = { player: 'играча', group: 'групата', set: 'набора' };

/** A player by name, as what a report is about. */
export function playerSubject(username: string): Subject | null {
  const u = getUserByName(username);
  return u ? { kind: 'player', id: String(u.id), owner: u.id, label: u.username } : null;
}

interface ReportRow {
  id: number;
  reporter_id: number | null;
  target_id: number;
  subject_kind: ReportSubjectKind;
  subject_id: string | null;
  reason: ReportReason;
  details: string | null;
  created_at: number;
}

/** How a reporter's word weighs: how long they've played, and how their earlier reports went. */
function reporterOf(id: number): Reporter | null {
  const r = one<{ username: string; created_at: number; games_played: number; upheld: number; dismissed: number }>(
    `SELECT u.username, u.created_at, u.games_played,
       (SELECT COUNT(*) FROM reports x WHERE x.reporter_id = u.id AND x.status = 'resolved' AND x.action <> 'dismiss') AS upheld,
       (SELECT COUNT(*) FROM reports x WHERE x.reporter_id = u.id AND x.status = 'resolved' AND x.action = 'dismiss') AS dismissed
     FROM users u WHERE u.id = ?`,
    id,
  );
  return r
    ? {
        id,
        name: r.username,
        days: Math.floor((Date.now() - r.created_at) / DAY),
        matches: r.games_played,
        upheld: r.upheld,
        dismissed: r.dismissed,
      }
    : null;
}

/** A case's thing as it is now: the group's or the set's name and size (a deleted one keeps its id). */
function describe(kind: ReportSubjectKind, id: string, ownerId: number): Omit<ReportCase, 'reports'> {
  const ownerRow = (userId: number) => {
    const u = getUser(userId)!;
    return { ...toPublicUser(u), bannedUntil: u.banned_until };
  };
  if (kind === 'group') {
    const g = one<{ name: string; owner_id: number | null; members: number }>(
      `SELECT name, owner_id, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members
       FROM player_groups g WHERE id = ?`,
      Number(id),
    );
    return {
      kind,
      id,
      owner: ownerRow(g?.owner_id ?? ownerId),
      name: g?.name ?? `Група №${id} (изтрита)`,
      size: g?.members ?? null,
      hidden: false,
    };
  }
  if (kind === 'set') {
    const set = one<{ name: string; owner_id: number; hidden: number; questions: string }>(
      'SELECT name, owner_id, hidden, questions FROM question_sets WHERE code = ?',
      id,
    );
    return {
      kind,
      id,
      owner: ownerRow(set?.owner_id ?? ownerId),
      name: set?.name ?? 'Изтрит набор',
      size: set ? (JSON.parse(set.questions) as unknown[]).length : null,
      hidden: set?.hidden === 1,
    };
  }
  return { kind, id, owner: ownerRow(ownerId), name: null, size: null, hidden: false };
}

/** Reports about staff (or what they made) are the owner's to see and decide: SQL on `reports r` for a viewer. */
const forViewer = (viewerId: number) => {
  const viewer = getUser(viewerId);
  return viewer && isOwner(viewer)
    ? '1'
    : 'NOT EXISTS (SELECT 1 FROM users s WHERE s.id = r.target_id AND s.is_admin = 1)';
};

/**
 * The queue: one case per reported thing, with every open report about it and who sent each. Those in most need first
 * — any illegal content, then the most reported, then the longest waiting — `limit` of them. A moderator's queue leaves
 * out reports about staff: those are the owner's.
 */
export function openCases(viewerId: number, limit = 25): ReportCases {
  const rows = all<ReportRow>(
    `SELECT id, reporter_id, target_id, subject_kind, subject_id, reason, details, created_at
     FROM reports r WHERE status = 'open' AND ${forViewer(viewerId)} ORDER BY created_at`,
  );
  const byCase = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const key = `${r.subject_kind}:${r.subject_kind === 'player' ? r.target_id : r.subject_id}`;
    byCase.set(key, [...(byCase.get(key) ?? []), r]);
  }
  const illegal = (rs: ReportRow[]) => rs.some((r) => r.reason === 'illegal');
  const ordered = [...byCase.values()].sort(
    (a, b) => Number(illegal(b)) - Number(illegal(a)) || b.length - a.length || a[0].created_at - b[0].created_at,
  );
  const reporters = new Map<number, Reporter | null>();
  const cases = ordered.slice(0, limit).map((rs): ReportCase => {
    const [first] = rs;
    const id = first.subject_kind === 'player' ? String(first.target_id) : first.subject_id!;
    return {
      ...describe(first.subject_kind, id, first.target_id),
      reports: rs.map((r) => {
        if (r.reporter_id !== null && !reporters.has(r.reporter_id))
          reporters.set(r.reporter_id, reporterOf(r.reporter_id));
        return {
          id: r.id,
          reason: r.reason,
          details: r.details,
          createdAt: r.created_at,
          reporter: r.reporter_id === null ? null : (reporters.get(r.reporter_id) ?? null),
        };
      }),
    };
  });
  return { cases, total: ordered.length };
}

export const openReportCount = (viewerId: number) =>
  one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM (SELECT DISTINCT subject_kind, CASE WHEN subject_kind = 'player' THEN target_id
     ELSE subject_id END FROM reports r WHERE status = 'open' AND ${forViewer(viewerId)})`,
  )!.n;

/**
 * Nobody decides about themselves, and decisions about staff (or what they made) are the owner's: one bad or stolen
 * moderator account can't lock the others out, or clear its own name. The reason why not, or null.
 */
function notTheirs(actorId: number, aboutId: number | null): string | null {
  if (aboutId === null) return null;
  if (aboutId === actorId) return 'Не можеш да решаваш за себе си — остави го на друг модератор.';
  const about = getUser(aboutId);
  const actor = getUser(actorId);
  return about && isAdmin(about) && !(actor && isOwner(actor)) ? 'Решение за модератор взема собственикът.' : null;
}

// ─── Decisions ───────────────────────────────────────────────────────────────
// Every one is logged (modlog.ts) with its basis and reason, and told (statements.ts): to the player, with where to
// appeal, and to whoever reported it. What can be undone keeps the state before.

const DAY = 24 * 60 * 60_000;

/** A basis from the list and a reason worth reading: what a decision about a player needs. */
function checkGrounds(basis: unknown, reason: string): string | null {
  if (!MODERATION_BASES.some((b) => b.id === basis)) return 'Избери основание.';
  if (reason.trim().length < MODERATION.reasonMin)
    return `Напиши причината (поне ${MODERATION.reasonMin} знака): играчът ще я прочете.`;
  return null;
}

/**
 * The reports a decision answers: the ones the moderator saw in a case (`reportIds`), or every open one about the
 * thing (a decision from a player's card, or a set's page).
 */
export type Closes = { reportIds: number[] } | { kind: ReportSubjectKind; id: string };

/** Closes them, and tells each sender what came of it (`about`: the thing's name as they knew it). Returns them. */
function closeReports(adminId: number, closes: Closes, outcome: Outcome, about: string) {
  const [where, args] =
    'reportIds' in closes
      ? [`id IN (${closes.reportIds.map(() => '?').join(', ') || 'NULL'})`, closes.reportIds]
      : aboutThing(closes.kind, closes.id);
  const rows = all<{ id: number; reporter_id: number | null; reason: string }>(
    `SELECT id, reporter_id, reason FROM reports WHERE status = 'open' AND ${where}`,
    ...args,
  );
  for (const r of rows)
    run(
      "UPDATE reports SET status = 'resolved', resolved_at = ?, resolved_by = ?, action = ? WHERE id = ?",
      Date.now(),
      adminId,
      outcome,
      r.id,
    );
  tellReporters(rows, about, outcome);
  return rows;
}

export function banPlayer(
  adminId: number,
  targetId: number,
  ban: { days: number | null; basis: ModerationBasis; reason: string; annul?: boolean },
  closes: Closes = { kind: 'player', id: String(targetId) },
): Result {
  const target = getUser(targetId);
  if (!target) return { ok: false, error: 'Няма такъв играч.' };
  const mine = notTheirs(adminId, targetId);
  if (mine) return { ok: false, error: mine };
  const problem = checkGrounds(ban.basis, ban.reason);
  if (problem) return { ok: false, error: problem };
  const reason = ban.reason.trim().slice(0, MODERATION.reasonMax);
  const until = ban.days === null ? FOREVER : Date.now() + ban.days * DAY;
  let onReport = false;
  tx(() => {
    run(
      'UPDATE users SET banned_until = ?, ban_reason = ?, ban_basis = ? WHERE id = ?',
      until,
      reason,
      ban.basis,
      targetId,
    );
    run('DELETE FROM sessions WHERE user_id = ?', targetId);
    // Its devices too, including any subscribed before subscriptions remembered their session (SEC-7).
    run('DELETE FROM push_subscriptions WHERE user_id = ?', targetId);
    onReport = closeReports(adminId, closes, 'ban', target.username).length > 0;
    logAction({
      adminId,
      action: 'ban',
      userId: targetId,
      basis: ban.basis,
      reason: `${ban.days === null ? 'Завинаги' : `${ban.days} дни`}. ${reason}`,
      undo: { bannedUntil: target.banned_until, reason: target.ban_reason, basis: target.ban_basis },
    });
  });
  if (ban.annul) annulResults(adminId, targetId, { basis: ban.basis, reason }, { told: false });
  removeFromPlay(targetId);
  disconnectUser(targetId);
  // Signed out for the ban: what they read is at sign-in (activeBan) and in the mail.
  tellPlayer(
    targetId,
    {
      what: `Модератор спря профила ти „${target.username}“ ${banEnd(until)}.${ban.annul ? ' Резултатите ти от този сезон са анулирани.' : ''}`,
      basis: ban.basis,
      reason,
      onReport,
      subject: `Профилът ти в ${BRAND.name} е спрян`,
      icon: '⛔',
      after: BANNED_DATA(),
    },
    { note: false },
  );
  return { ok: true };
}

const banEnd = (until: number) => (until >= FOREVER ? 'за постоянно' : `до ${longDateTime(until)}`);

/** A banned player can't sign in to Settings: their data and the account's deletion are a mail away (GDPR Art. 15, 17). */
const BANNED_DATA = () =>
  `Докато профилът е спрян, можеш да поискаш данните си или да изтрием профила — пиши ни на ${config.operator.email}.`;

/** Lifts a ban now, or moves its end (`days` from now). */
export function changeBan(adminId: number, targetId: number, days: number | null, reason: string): Result {
  const target = getUser(targetId);
  if (!target) return { ok: false, error: 'Няма такъв играч.' };
  const mine = notTheirs(adminId, targetId);
  if (mine) return { ok: false, error: mine };
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
    tellReversal(targetId, 'Модератор свали спирането на профила ти: можеш да играеш отново.', reason, '🕊️');
  else
    tellPlayer(
      targetId,
      {
        what: `Модератор промени края на спирането на профила ти: вече е ${banEnd(until)}.`,
        basis: (target.ban_basis as ModerationBasis | null) ?? null,
        reason,
        onReport: false,
        subject: `Спирането на профила ти в ${BRAND.name} е променено`,
        icon: '⛔',
        after: BANNED_DATA(),
      },
      { note: false },
    );
  return { ok: true };
}

export function renamePlayer(
  adminId: number,
  targetId: number,
  rename: { username: string; basis: ModerationBasis; reason: string },
  closes: Closes = { kind: 'player', id: String(targetId) },
): Result {
  const target = getUser(targetId);
  if (!target) return { ok: false, error: 'Няма такъв играч.' };
  const mine = notTheirs(adminId, targetId);
  if (mine) return { ok: false, error: mine };
  const problem = checkGrounds(rename.basis, rename.reason);
  if (problem) return { ok: false, error: problem };
  const name = rename.username.trim();
  if (name.length < USERNAME.min || name.length > USERNAME.max || !USERNAME.chars.test(name))
    return {
      ok: false,
      error: `Името трябва да е ${USERNAME.min}–${USERNAME.max} букви, цифри, точка, тире или долна черта.`,
    };
  const bad = nameProblem(name);
  if (bad) return { ok: false, error: bad };
  const taken = nameTaken(name, targetId);
  if (taken) return { ok: false, error: taken };
  const reason = rename.reason.trim().slice(0, MODERATION.reasonMax);
  let onReport = false;
  tx(() => {
    setName(targetId, name);
    onReport = closeReports(adminId, closes, 'rename', target.username).length > 0;
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
  tellPlayer(targetId, {
    what: `Модератор смени името ти „${target.username}“ на „${name}“.`,
    basis: rename.basis,
    reason,
    onReport,
    subject: `Името ти в ${BRAND.name} е сменено`,
    icon: '✏️',
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
 * board, and this season's evening places go (what the player is told: earlier seasons stand). The rows are kept in the log, for an undo. `told: false`: part of a ban, whose
 * statement says it.
 */
export function annulResults(
  adminId: number,
  targetId: number,
  grounds: { basis: ModerationBasis; reason: string },
  { told = true } = {},
): Result {
  if (!getUser(targetId)) return { ok: false, error: 'Няма такъв играч.' };
  const mine = notTheirs(adminId, targetId);
  if (mine) return { ok: false, error: mine };
  const problem = checkGrounds(grounds.basis, grounds.reason);
  if (problem) return { ok: false, error: problem };
  const reason = grounds.reason.trim().slice(0, MODERATION.reasonMax);
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
      evening: all(
        'SELECT day, placement, score, players FROM evening_results WHERE user_id = ? AND day >= ?',
        targetId,
        `${season}-01`,
      ),
    };
    run('DELETE FROM season_ratings WHERE user_id = ? AND season = ?', targetId, season);
    run('UPDATE daily_results SET own_set = 1 WHERE user_id = ? AND day >= ?', targetId, `${season}-01`);
    run('DELETE FROM evening_results WHERE user_id = ? AND day >= ?', targetId, `${season}-01`);
    logAction({ adminId, action: 'annul', userId: targetId, basis: grounds.basis, reason, undo });
  });
  if (told)
    tellPlayer(targetId, {
      what: 'Модератор анулира резултатите ти от този сезон: рейтингите започват отначало, а дневните и вечерните ти класирания са махнати.',
      basis: grounds.basis,
      reason,
      onReport: false,
      subject: `Резултатите ти в ${BRAND.name} са анулирани`,
      icon: '🧾',
    });
  return { ok: true };
}

/** „Няма нарушение“: the reports close, their senders hear so, and the log keeps which (an undo opens them again). */
function dismiss(adminId: number, kind: ReportSubjectKind, id: string, closes: Closes): Result {
  const owner = one<{ target_id: number }>(
    `SELECT target_id FROM reports WHERE status = 'open' AND ${aboutThing(kind, id)[0]} LIMIT 1`,
    ...aboutThing(kind, id)[1],
  );
  if (!owner) return { ok: false, error: 'Няма отворени доклади.' };
  const mine = notTheirs(adminId, owner.target_id);
  if (mine) return { ok: false, error: mine };
  const thing = describe(kind, id, owner.target_id);
  tx(() => {
    const closed = closeReports(adminId, closes, 'dismiss', thing.name ?? thing.owner.username);
    logAction({
      adminId,
      action: 'dismiss_reports',
      userId: thing.owner.id,
      target: kind === 'player' ? null : id,
      undo: { reports: closed.map((r) => r.id) },
    });
  });
  return { ok: true };
}

const upheldReports = (reporterId: number) =>
  one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND status = 'resolved' AND action <> 'dismiss'",
    reporterId,
  )!.n;

/**
 * „Отхвърли всички от …“: every open report one player sent closes as no violation (a flood of them from one account),
 * except what this moderator can't decide (about themselves or staff); the log keeps which, and an undo opens them
 * again. The reporter hears it once.
 */
export function dismissReporter(adminId: number, reporterId: number): Result {
  const reporter = getUser(reporterId);
  if (!reporter) return { ok: false, error: 'Няма такъв играч.' };
  const open = all<{ id: number; target_id: number }>(
    "SELECT id, target_id FROM reports WHERE status = 'open' AND reporter_id = ?",
    reporterId,
  ).filter((r) => !notTheirs(adminId, r.target_id));
  if (!open.length) return { ok: false, error: 'Няма отворени доклади от този играч.' };
  tx(() => {
    const closed = closeReports(adminId, { reportIds: open.map((r) => r.id) }, 'dismiss', `${open.length} доклада`);
    logAction({ adminId, action: 'dismiss_reports', userId: reporterId, undo: { reports: closed.map((r) => r.id) } });
  });
  return { ok: true };
}

/**
 * „Спри докладите му за 30 дни“: a player whose reports are again and again without grounds can't send any for a while
 * (DSA Art. 23, Terms §3а), after the note it's told. Undone from the log.
 */
export function stopReports(
  adminId: number,
  reporterId: number,
  grounds: { basis: ModerationBasis; reason: string },
): Result {
  const reporter = getUser(reporterId);
  if (!reporter) return { ok: false, error: 'Няма такъв играч.' };
  const mine = notTheirs(adminId, reporterId);
  if (mine) return { ok: false, error: mine };
  const problem = checkGrounds(grounds.basis, grounds.reason);
  if (problem) return { ok: false, error: problem };
  const until = Date.now() + 30 * DAY;
  const reason = grounds.reason.trim().slice(0, MODERATION.reasonMax);
  tx(() => {
    run('UPDATE users SET reports_stopped_until = ? WHERE id = ?', until, reporterId);
    logAction({
      adminId,
      action: 'stop_reports',
      userId: reporterId,
      basis: grounds.basis,
      reason,
      undo: { until: reporter.reports_stopped_until },
    });
  });
  tellPlayer(reporterId, {
    what: `Модератор спря докладите ти до ${longDateTime(until)}: много от тях бяха без основание.`,
    basis: grounds.basis,
    reason,
    onReport: false,
    subject: `Докладите ти в ${BRAND.name} са спрени за 30 дни`,
    icon: '🛡️',
  });
  return { ok: true };
}

/** „Няма нарушение“ from a player's card: every open report about them. */
export const dismissReports = (adminId: number, targetId: number): Result =>
  getUser(targetId)
    ? dismiss(adminId, 'player', String(targetId), { kind: 'player', id: String(targetId) })
    : { ok: false, error: 'Няма такъв играч.' };

const STALE = 'Случаят се промени: друг модератор вече реши част от него. Зареди опашката отново.';

/**
 * A case decided: it answers exactly the reports the moderator saw (`reportIds`). One that another moderator closed
 * meanwhile makes it a conflict (409); reports that came in since stay open.
 */
export function decideCase(
  adminId: number,
  kind: ReportSubjectKind,
  id: string,
  reportIds: number[],
  decision: CaseDecision,
): Result {
  const [where, args] = aboutThing(kind, id);
  const open = new Set(
    all<{ id: number }>(`SELECT id FROM reports WHERE status = 'open' AND ${where}`, ...args).map((r) => r.id),
  );
  if (!reportIds.length || reportIds.some((r) => !open.has(r))) return { ok: false, status: 409, error: STALE };
  const closes = { reportIds };
  const wrong: Result = { ok: false, error: 'Това решение не е за този случай.' };
  switch (decision.action) {
    case 'dismiss':
      return dismiss(adminId, kind, id, closes);
    case 'rename':
      return kind === 'player' ? renamePlayer(adminId, Number(id), decision, closes) : wrong;
    case 'ban':
      return kind === 'player' ? banPlayer(adminId, Number(id), decision, closes) : wrong;
    case 'rename_group':
      return kind === 'group'
        ? renameGroupByModerator(adminId, Number(id), decision.basis, decision.reason, closes)
        : wrong;
    case 'hide_set':
      return kind === 'set' ? hideSetByModerator(adminId, id, true, decision, closes) : wrong;
  }
}

/** A group a moderator renamed keeps the name this long: its owner can't put the old one straight back. */
export const GROUP_NAME_LOCK_MS = 7 * DAY;

/** A group's name that broke the rules: it becomes „Група N“ for a week at least, and its owner hears why. */
export function renameGroupByModerator(
  adminId: number,
  groupId: number,
  basis: ModerationBasis,
  reason: string,
  closes: Closes = { kind: 'group', id: String(groupId) },
): Result {
  const group = one<{ name: string; owner_id: number | null }>(
    'SELECT name, owner_id FROM player_groups WHERE id = ?',
    groupId,
  );
  if (!group) return { ok: false, error: 'Няма такава група.' };
  const mine = notTheirs(adminId, group.owner_id);
  if (mine) return { ok: false, error: mine };
  const problem = checkGrounds(basis, reason);
  if (problem) return { ok: false, error: problem };
  const name = `Група ${groupId}`;
  const why = reason.trim().slice(0, MODERATION.reasonMax);
  let onReport = false;
  tx(() => {
    run(
      'UPDATE player_groups SET name = ?, name_locked_until = ? WHERE id = ?',
      name,
      Date.now() + GROUP_NAME_LOCK_MS,
      groupId,
    );
    onReport = closeReports(adminId, closes, 'rename_group', group.name).length > 0;
    logAction({
      adminId,
      action: 'rename_group',
      userId: group.owner_id,
      target: String(groupId),
      basis,
      reason: `„${group.name}“ → „${name}“. ${why}`,
      undo: { name: group.name },
    });
  });
  if (group.owner_id)
    tellPlayer(group.owner_id, {
      what: `Модератор смени името на групата ти „${group.name}“ на „${name}“. След седмица можеш да ѝ дадеш друго.`,
      basis,
      reason: why,
      onReport,
      subject: 'Името на групата ти е сменено',
      icon: '✏️',
      link: `/groups/${groupId}`,
    });
  return { ok: true };
}

/**
 * A moderator hides a shared set (it can't be played, copied or edited, and its pictures are blocked for good), on a
 * basis and with a reason its owner reads — with `copies`, every copy taken of it too (each a decision of its own,
 * told to its owner); or shows it again, with why.
 */
export function hideSetByModerator(
  adminId: number,
  code: string,
  hidden: boolean,
  grounds: { basis?: ModerationBasis | null; reason: string; copies?: boolean },
  closes: Closes = { kind: 'set', id: code },
): Result {
  const problem = hidden
    ? checkGrounds(grounds.basis, grounds.reason)
    : grounds.reason.trim().length < MODERATION.reasonMin
      ? `Напиши защо (поне ${MODERATION.reasonMin} знака).`
      : null;
  if (problem) return { ok: false, error: problem };
  const set = one<{ owner_id: number; name: string; hidden: number }>(
    'SELECT owner_id, name, hidden FROM question_sets WHERE code = ?',
    code,
  );
  if (!set) return { ok: false, error: 'Няма такъв набор.', status: 404 };
  const mine = notTheirs(adminId, set.owner_id);
  if (mine) return { ok: false, error: mine };
  if (set.hidden === Number(hidden))
    return { ok: false, error: hidden ? 'Наборът вече е скрит.' : 'Наборът не е скрит.' };
  const reason = grounds.reason.trim().slice(0, MODERATION.reasonMax);
  let onReport = false;
  tx(() => {
    hideSet(code, hidden);
    if (hidden) onReport = closeReports(adminId, closes, 'hide_set', set.name).length > 0;
    logAction({
      adminId,
      action: hidden ? 'hide_set' : 'unhide_set',
      userId: set.owner_id,
      target: code,
      basis: hidden ? (grounds.basis ?? null) : null,
      reason,
      undo: {},
    });
  });
  if (hidden)
    tellPlayer(set.owner_id, {
      what: `Модератор скри набора ти „${set.name}“: вече не може да се играе в стаи, нито да се копира.`,
      basis: grounds.basis ?? null,
      reason,
      onReport,
      subject: 'Наборът ти е скрит',
      icon: '🙈',
      link: '/sets',
    });
  else tellReversal(set.owner_id, `Наборът ти „${set.name}“ отново може да се играе и копира.`, reason, '👁️', '/sets');
  if (hidden && grounds.copies)
    for (const copy of copiesOf(code)) hideCopy(adminId, copy, set.name, grounds.basis ?? null, reason);
  return { ok: true };
}

/** A copy of a hidden set goes with it (unless it's staff's: that's the owner's to decide). */
function hideCopy(adminId: number, code: string, of: string, basis: ModerationBasis | null, reason: string) {
  const copy = one<{ owner_id: number; name: string }>('SELECT owner_id, name FROM question_sets WHERE code = ?', code);
  if (!copy || notTheirs(adminId, copy.owner_id)) return;
  tx(() => {
    hideSet(code, true);
    logAction({
      adminId,
      action: 'hide_set',
      userId: copy.owner_id,
      target: code,
      basis,
      reason: `Копие на „${of}“. ${reason}`,
      undo: {},
    });
  });
  tellPlayer(copy.owner_id, {
    what: `Модератор скри набора ти „${copy.name}“ — копие на набор, скрит заради съдържанието му: вече не може да се играе в стаи, нито да се копира.`,
    basis,
    reason,
    onReport: false,
    subject: 'Наборът ти е скрит',
    icon: '🙈',
    link: '/sets',
  });
}

// ─── Players, for moderators ─────────────────────────────────────────────────

const toHit = (u: UserRow): PlayerSearchHit => ({
  user: toPublicUser(u),
  isGuest: u.is_guest === 1,
  banned: !!u.banned_until && u.banned_until > Date.now(),
  createdAt: u.created_at,
});

/**
 * Players by (part of) their name: exact first, then those starting with it, then any containing it. `#42` (or 42) is
 * the player with that number, and a whole e-mail address the one whose verified address it is (an appeal comes by
 * mail): the hit shows only that it matched, never the address.
 */
export function searchPlayers(query: string): PlayerSearchHit[] {
  const q = query.trim();
  const number = /^#?(\d{1,9})$/.exec(q);
  const exact = number
    ? getUser(Number(number[1]))
    : q.includes('@')
      ? one<UserRow>('SELECT * FROM users WHERE email = ? COLLATE NOCASE', q)
      : undefined;
  if (number || q.includes('@')) return exact ? [toHit(exact)] : [];
  const key = usernameKey(q);
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
    staff: isAdmin(u) ? (u.staff_role ?? 'moderator') : null,
    bannedBefore: bannedBefore(u.email),
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

/**
 * Takes back a logged decision, as far as it can be (a name taken since can't be given back), with a reason the log
 * keeps; the player hears it as they heard the decision. Logged as undone.
 */
export function undoAction(adminId: number, logId: number, why: string): Result {
  const row = logRow(logId);
  if (!row) return { ok: false, error: 'Няма такъв запис.' };
  if (row.undone_at !== null) return { ok: false, error: 'Вече е отменено.' };
  const undo = parseUndo<Record<string, unknown>>(row);
  if (!undo) return { ok: false, error: 'Това не може да се отмени.' };
  if (laterDecision(row)) return { ok: false, error: 'По-късно решение промени това — отмени първо него.' };
  const reason = why.trim().slice(0, MODERATION.reasonMax);
  if (reason.length < MODERATION.reasonMin)
    return { ok: false, error: `Напиши защо го отменяш (поне ${MODERATION.reasonMin} знака).` };
  const userId = row.target_user_id;
  const mine = notTheirs(adminId, userId);
  if (mine) return { ok: false, error: mine };
  switch (row.action) {
    case 'ban':
    case 'unban':
    case 'ban_change': {
      if (userId === null) return { ok: false, error: 'Играчът вече го няма.' };
      const until = (undo.bannedUntil as number | null) ?? null;
      run(
        'UPDATE users SET banned_until = ?, ban_reason = ?, ban_basis = ? WHERE id = ?',
        until,
        (undo.reason as string | null) ?? null,
        (undo.basis as string | null) ?? null,
        userId,
      );
      if (until !== null && until > Date.now()) {
        // Banned again by the undo: off the game at once, and told by mail (a note can't be read while banned).
        if (row.action !== 'ban') {
          run('DELETE FROM sessions WHERE user_id = ?', userId);
          removeFromPlay(userId);
          disconnectUser(userId);
        }
        tellPlayer(
          userId,
          {
            what: `Модератор върна спирането на профила ти: то е ${banEnd(until)}.`,
            basis: (undo.basis as ModerationBasis | null) ?? null,
            reason,
            onReport: false,
            subject: `Профилът ти в ${BRAND.name} е спрян`,
            icon: '⛔',
            after: BANNED_DATA(),
          },
          { note: false },
        );
      } else tellReversal(userId, 'Модератор отмени спирането на профила ти: можеш да играеш отново.', reason, '🕊️');
      break;
    }
    case 'rename': {
      if (userId === null) return { ok: false, error: 'Играчът вече го няма.' };
      const old = String(undo.username);
      const taken = nameTaken(old, userId);
      if (taken) return { ok: false, error: `„${old}“ вече е заето.` };
      setName(userId, old);
      afterRename(userId);
      tellReversal(userId, `Модератор върна името ти „${old}“.`, reason, '✏️');
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
      tellReversal(userId, 'Модератор върна резултатите ти от този сезон.', reason, '🧾');
      break;
    }
    case 'rename_group': {
      const name = String(undo.name);
      run('UPDATE player_groups SET name = ?, name_locked_until = NULL WHERE id = ?', name, Number(row.target));
      if (userId !== null)
        tellReversal(userId, `Групата ти отново се казва „${name}“.`, reason, '✏️', `/groups/${row.target}`);
      break;
    }
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
    case 'unhide_set': {
      const shown = row.action === 'hide_set';
      const set = hideSet(String(row.target), !shown);
      if (set)
        tellReversal(
          set.ownerId,
          shown
            ? `Наборът ти „${set.name}“ отново може да се играе и копира.`
            : `Наборът ти „${set.name}“ отново е скрит: не може да се играе, нито да се копира.`,
          reason,
          shown ? '👁️' : '🙈',
          '/sets',
        );
      break;
    }
    case 'approve':
      // An approval taken back: the question leaves play.
      hideQuestion(adminId, String(row.target));
      break;
    case 'dismiss_flags': {
      // „Въпросът е наред“ taken back: the flags open again, and a question they had hidden is hidden again.
      for (const id of (undo.flags as number[] | undefined) ?? [])
        run(
          "UPDATE question_reports SET status = 'open', resolved_at = NULL, resolved_by = NULL WHERE id = ? AND status = 'dismissed'",
          id,
        );
      if (undo.hidden) hideQuestion(adminId, String(row.target));
      break;
    }
    case 'stop_reports': {
      if (userId === null) return { ok: false, error: 'Играчът вече го няма.' };
      run('UPDATE users SET reports_stopped_until = ? WHERE id = ?', (undo.until as number | null) ?? null, userId);
      break;
    }
    case 'dismiss_reports': {
      // The reports open again, for a decision.
      const ids = (undo.reports as number[] | undefined) ?? [];
      for (const id of ids)
        run(
          "UPDATE reports SET status = 'open', resolved_at = NULL, resolved_by = NULL, action = NULL WHERE id = ? AND action = 'dismiss'",
          id,
        );
      break;
    }
    default:
      return { ok: false, error: 'Това не може да се отмени.' };
  }
  markUndone(logId, adminId, reason);
  return { ok: true };
}
