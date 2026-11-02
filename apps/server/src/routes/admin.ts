import {
  type AdminSummary,
  MODERATION,
  MODERATION_BASES,
  type ModerationBasis,
  type SubmissionStatus,
} from '@quiz/shared';
import { type Request, Router } from 'express';
import { z } from 'zod';
import { eraseOnRequest, exportAccount } from '../account';
import { playCheck } from '../answers';
import { requireAuth } from '../auth';
import {
  annulResults,
  banPlayer,
  changeBan,
  decideCase,
  dismissReporter,
  dismissReports,
  openCases,
  openReportCount,
  playerCard,
  renameGroupByModerator,
  renamePlayer,
  searchPlayers,
  stopReports,
  undoAction,
} from '../moderation';
import { logAction, moderationLog, QUESTION_ACTIONS } from '../modlog';
import {
  hiddenQuestions,
  openQuestionReportCount,
  openQuestionReports,
  resolveQuestionReports,
  settleBankFixes,
  unhideQuestion,
} from '../questionReports';
import { bankProblem, questionById, reloadQuestionBank } from '../questions';
import { deletePicture, pictureForModerator, setForModerator } from '../sets';
import { tellPlayer } from '../statements';
import { launchStats } from '../stats';
import {
  approveSubmission,
  DraftSchema,
  editCommunityQuestion,
  listSubmissions,
  pendingCount,
  rejectSubmission,
  similarQuestions,
} from '../submissions';
import { getUser, isAdmin } from '../users';
import {
  idParam,
  parse,
  requireAdmin,
  requireOwner,
  requireRecentPassword,
  requireStaff,
  secondFactor,
} from './common';

/**
 * The moderators' API (/admin): the queues (proposed questions, flags on questions, reports about players), the
 * players, the log of every decision (with undo), and the numbers. What changes anything also wants the password
 * given within the hour (requireRecentPassword).
 */
export const adminRouter = Router();

/**
 * What waits (the home card and the tabs count it), with where the second factor stands: staff only, but no code
 * needed — it's how the page knows to ask for one, or to set an app up.
 */
adminRouter.get('/admin/summary', requireAuth, requireStaff, (_req, res) => {
  const summary: AdminSummary = {
    pendingQuestions: pendingCount(),
    openReports: openReportCount(res.locals.userId),
    questionReports: openQuestionReportCount(),
    secondFactor: secondFactor(res),
  };
  res.json(summary);
});

adminRouter.use('/admin', requireAuth, requireAdmin);
const change = requireRecentPassword;

type Result = { ok: true } | { ok: false; error: string; status?: number };
const reply = (res: import('express').Response, result: Result, body: () => object = () => ({ ok: true })) => {
  if (!result.ok) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  res.json(body());
};

const Basis = z.enum(MODERATION_BASES.map((b) => b.id) as [ModerationBasis, ...ModerationBasis[]], {
  message: 'Избери основание.',
});
const Reason = z.string().max(MODERATION.reasonMax).default('');

adminRouter.get('/admin/stats', requireOwner, (_req, res) => {
  res.json(launchStats());
});

adminRouter.get('/admin/play-check', (_req, res) => {
  res.json(playCheck());
});

// ─── Proposed questions ──────────────────────────────────────────────────────

adminRouter.get('/admin/submissions', (req, res) => {
  const status = z
    .enum(['pending', 'approved', 'rejected'])
    .catch('pending')
    .parse(req.query.status) as SubmissionStatus;
  res.json({ submissions: listSubmissions(status), pending: pendingCount() });
});

adminRouter.get('/admin/submissions/:id/similar', (req, res) => {
  res.json({ similar: similarQuestions(idParam(req)) });
});

adminRouter.post('/admin/submissions/:id/approve', change, (req, res) => {
  const body = parse(z.object({ edits: DraftSchema.nullable().optional() }), req, res);
  if (!body) return;
  reply(res, approveSubmission(res.locals.userId, idParam(req), body.edits ?? null), () => ({
    ok: true,
    pending: pendingCount(),
  }));
});

adminRouter.post('/admin/submissions/:id/reject', change, (req, res) => {
  const body = parse(z.object({ reason: Reason }), req, res);
  if (!body) return;
  reply(res, rejectSubmission(res.locals.userId, idParam(req), body.reason), () => ({
    ok: true,
    pending: pendingCount(),
  }));
});

/** A player's question already in the game, corrected. */
adminRouter.put('/admin/questions/:id', change, (req, res) => {
  const draft = parse(DraftSchema, req, res);
  if (!draft) return;
  // Why, beside the draft: its author reads it.
  const why = Reason.safeParse((req.body as { reason?: unknown } | undefined)?.reason);
  reply(res, editCommunityQuestion(res.locals.userId, String(req.params.id), draft, why.success ? why.data : ''));
});

/** The bank read again from disk (after a pull of the private bank, without a restart). */
adminRouter.post('/admin/bank/reload', requireOwner, change, (_req, res) => {
  reloadQuestionBank();
  // Fixes the bank brought: their flags close, the questions come back.
  settleBankFixes();
  const problem = bankProblem();
  if (problem) {
    res.status(400).json({ error: 'Банката не се зареди — играта продължава с предишната. Виж грешките в Sentry.' });
    return;
  }
  logAction({ adminId: res.locals.userId, action: 'reload_bank' });
  res.json({ ok: true });
});

// ─── Flags on questions ──────────────────────────────────────────────────────

const flagsNow = () => ({ groups: openQuestionReports(), hidden: hiddenQuestions() });

adminRouter.get('/admin/question-reports', (_req, res) => {
  res.json(flagsNow());
});

adminRouter.post('/admin/question-reports/:id/resolve', change, (req, res) => {
  // Hiding a player's question takes a basis and reason, as a set's hide does: its author reads them.
  const body = parse(
    z.object({
      action: z.enum(['dismiss', 'hide', 'fixed', 'awaiting_fix']),
      basis: Basis.optional(),
      reason: Reason,
    }),
    req,
    res,
  );
  if (!body) return;
  reply(
    res,
    resolveQuestionReports(res.locals.userId, String(req.params.id), body.action, {
      basis: body.basis ?? null,
      reason: body.reason.trim(),
    }),
    flagsNow,
  );
});

adminRouter.post('/admin/hidden-questions/:id/unhide', change, (req, res) => {
  reply(res, unhideQuestion(String(req.params.id), res.locals.userId), flagsNow);
});

// ─── Reports about players, and the players ──────────────────────────────────

/** The queue, a page at a time: `limit` grows by 25 with „Покажи още“ (up to 200). */
adminRouter.get('/admin/reports', (req, res) => {
  const limit = Math.min(200, Math.max(25, Number(req.query.limit) || 25));
  res.json(openCases(res.locals.userId, limit));
});

const Decision = z.discriminatedUnion('action', [
  z.object({ action: z.literal('dismiss') }),
  z.object({ action: z.literal('rename'), username: z.string().max(40).optional(), basis: Basis, reason: Reason }),
  z.object({
    action: z.literal('ban'),
    days: z.number().int().min(1).max(3650).nullable(),
    basis: Basis,
    reason: Reason,
    annul: z.boolean().optional(),
  }),
  z.object({ action: z.literal('rename_group'), basis: Basis, reason: Reason }),
  z.object({ action: z.literal('hide_set'), basis: Basis, reason: Reason, copies: z.boolean().optional() }),
]);

/** A case decided: the reports the moderator saw in it (`reportIds`), and what was decided. */
adminRouter.post('/admin/cases/:kind/:id/resolve', change, (req, res) => {
  const body = parse(
    z.object({ reportIds: z.array(z.number().int().positive()).min(1).max(500), decision: Decision }),
    req,
    res,
  );
  if (!body) return;
  const kind = z.enum(['player', 'group', 'set']).safeParse(req.params.kind);
  if (!kind.success) {
    res.status(404).json({ error: 'Няма такъв случай.' });
    return;
  }
  const id = String(req.params.id).slice(0, 32);
  reply(res, decideCase(res.locals.userId, kind.data, id, body.reportIds, body.decision), () => ({
    ok: true,
    ...openCases(res.locals.userId),
  }));
});

/** A reported set, all of it, for the moderator to read (hidden or not). */
/** A set's picture for a moderator's eyes, blocked or not (setForModerator points here): never cached, never framed. */
adminRouter.get('/admin/pictures/:id', (req, res) => {
  const id = String(req.params.id);
  const file = /^[0-9a-f]{16}$/.test(id) ? pictureForModerator(id) : undefined;
  if (!file) {
    res.status(404).json({ error: 'Няма такава снимка.' });
    return;
  }
  res.set({
    'Content-Type': file.type,
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
    'Content-Security-Policy': "default-src 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.send(Buffer.from(file.bytes));
});

/**
 * „Изтрий снимката“ (the owner's, under the written procedure for illegal pictures — docs/operations.md): its bytes go
 * from every copy and every set, its hash stays blocked. Logged; whoever had it in a set hears why. For good.
 */
adminRouter.post('/admin/pictures/:id/delete', requireOwner, change, (req, res) => {
  const body = parse(z.object({ reason: Reason }), req, res);
  if (!body) return;
  const id = String(req.params.id);
  const reason = body.reason.trim();
  if (!/^[0-9a-f]{16}$/.test(id) || !pictureForModerator(id)) {
    res.status(404).json({ error: 'Няма такава снимка.' });
    return;
  }
  if (reason.length < MODERATION.reasonMin) {
    res.status(400).json({ error: `Напиши защо (поне ${MODERATION.reasonMin} знака).` });
    return;
  }
  const sets = deletePicture(id);
  logAction({ adminId: res.locals.userId, action: 'delete_picture', target: id, basis: 'content', reason });
  for (const s of sets)
    tellPlayer(s.ownerId, {
      what: `Модератор изтри снимка от набора ти „${s.name}“: въпросът остава без нея.`,
      basis: 'content',
      reason,
      onReport: true,
      subject: 'Снимка от набора ти е изтрита',
      icon: '🖼️',
      link: '/sets',
    });
  res.json({ ok: true, sets: sets.length });
});

adminRouter.get('/admin/sets/:code', (req, res) => {
  const set = setForModerator(String(req.params.code).slice(0, 32));
  if (!set) {
    res.status(404).json({ error: 'Няма такъв набор.' });
    return;
  }
  res.json({ set });
});

adminRouter.get('/admin/players', (req, res) => {
  res.json({ players: searchPlayers(String(req.query.q ?? '').slice(0, 40)) });
});

const cardOf = (req: Request) => () => ({ card: playerCard(idParam(req)) });

adminRouter.get('/admin/players/:id', (req, res) => {
  const card = playerCard(idParam(req));
  if (!card) {
    res.status(404).json({ error: 'Няма такъв играч.' });
    return;
  }
  res.json({ card });
});

/**
 * A player's data rights carried out for them, on a request that came by mail (the privacy policy, §8 and §10: a parent,
 * someone who can't sign in): the owner downloads the data to send, or erases the account the way „Изтрий профила“
 * does. Logged, without the name (`reason`: how the request came and how it was checked). Not for staff: their role goes
 * first (`cli admin remove`).
 */
const DataRequest = z.object({
  reason: z
    .string()
    .trim()
    .min(MODERATION.reasonMin, 'Напиши как дойде искането и как провери кой е (без името).')
    .max(MODERATION.reasonMax),
});

function requestable(req: Request, res: import('express').Response): number | null {
  const id = idParam(req);
  const user = getUser(id);
  if (!user) res.status(404).json({ error: 'Няма такъв играч.' });
  else if (id === res.locals.userId || isAdmin(user))
    res.status(400).json({ error: 'Не и за профил от екипа: първо махни ролята (cli admin remove).' });
  else return id;
  return null;
}

adminRouter.post('/admin/players/:id/export', requireOwner, change, (req, res) => {
  const body = parse(DataRequest, req, res);
  if (!body) return;
  const id = requestable(req, res);
  if (id === null) return;
  logAction({ adminId: res.locals.userId, action: 'export_data', userId: id, reason: body.reason });
  res.setHeader('content-disposition', `attachment; filename="almanac-data-${id}.json"`);
  res.type('application/json').send(JSON.stringify(exportAccount(id), null, 2));
});

adminRouter.post('/admin/players/:id/erase', requireOwner, change, (req, res) => {
  const body = parse(DataRequest, req, res);
  if (!body) return;
  const id = requestable(req, res);
  if (id === null) return;
  eraseOnRequest(id);
  // After the erasure, which takes every entry about them: this one names nobody.
  logAction({ adminId: res.locals.userId, action: 'erase_request', reason: body.reason });
  res.json({ ok: true });
});

adminRouter.post('/admin/players/:id/ban', change, (req, res) => {
  const body = parse(
    z.object({
      days: z.number().int().min(1).max(3650).nullable(),
      basis: Basis,
      reason: Reason,
      annul: z.boolean().optional(),
    }),
    req,
    res,
  );
  if (!body) return;
  reply(res, banPlayer(res.locals.userId, idParam(req), body), cardOf(req));
});

/** Lifts a ban (`days` null) or moves its end. */
adminRouter.post('/admin/players/:id/ban-change', change, (req, res) => {
  const body = parse(
    z.object({
      days: z.number().int().min(1).max(3650).nullable(),
      reason: Reason,
      restore: z.boolean().default(false),
    }),
    req,
    res,
  );
  if (!body) return;
  reply(
    res,
    changeBan(res.locals.userId, idParam(req), body.days, body.reason, { restore: body.restore }),
    cardOf(req),
  );
});

adminRouter.post('/admin/players/:id/rename', change, (req, res) => {
  const body = parse(z.object({ username: z.string().max(40).optional(), basis: Basis, reason: Reason }), req, res);
  if (!body) return;
  reply(res, renamePlayer(res.locals.userId, idParam(req), body), cardOf(req));
});

adminRouter.post('/admin/players/:id/annul', change, (req, res) => {
  const body = parse(z.object({ basis: Basis, reason: Reason }), req, res);
  if (!body) return;
  reply(res, annulResults(res.locals.userId, idParam(req), body), cardOf(req));
});

adminRouter.post('/admin/players/:id/dismiss', change, (req, res) => {
  reply(res, dismissReports(res.locals.userId, idParam(req)), cardOf(req));
});

/** A reporter's flood: every open report they sent, closed as no violation (MOD-3). */
adminRouter.post('/admin/reporters/:id/dismiss', change, (req, res) => {
  reply(res, dismissReporter(res.locals.userId, idParam(req)), () => ({ ok: true, ...openCases(res.locals.userId) }));
});

/** A reporter in bad faith: no reports from them for 30 days (MOD-3). */
adminRouter.post('/admin/reporters/:id/stop', change, (req, res) => {
  const body = parse(z.object({ basis: Basis, reason: Reason }), req, res);
  if (!body) return;
  reply(res, stopReports(res.locals.userId, idParam(req), body), () => ({ ok: true, ...openCases(res.locals.userId) }));
});

adminRouter.post('/admin/groups/:id/rename', change, (req, res) => {
  const body = parse(z.object({ basis: Basis, reason: Reason }), req, res);
  if (!body) return;
  reply(res, renameGroupByModerator(res.locals.userId, idParam(req), body.basis, body.reason));
});

// ─── The log ─────────────────────────────────────────────────────────────────

adminRouter.get('/admin/log', (req, res) => {
  const before = Number(req.query.before);
  // A question's entry says which question, in its words.
  const entries = moderationLog(50, Number.isInteger(before) && before > 0 ? before : null).map((e) => {
    const q = e.target && QUESTION_ACTIONS.has(e.action) ? questionById(e.target) : undefined;
    return q ? { ...e, about: q.q.length > 80 ? `${q.q.slice(0, 80)}…` : q.q } : e;
  });
  res.json({ entries });
});

adminRouter.post('/admin/log/:id/undo', change, (req, res) => {
  const body = parse(z.object({ reason: Reason }), req, res);
  if (!body) return;
  reply(res, undoAction(res.locals.userId, idParam(req), body.reason), () => ({
    ok: true,
    entries: moderationLog(50),
  }));
});
