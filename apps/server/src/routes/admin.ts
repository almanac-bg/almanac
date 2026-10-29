import { MODERATION, MODERATION_BASES, type ModerationBasis, type SubmissionStatus } from '@quiz/shared';
import { type Request, Router } from 'express';
import { z } from 'zod';
import { playCheck } from '../answers';
import { requireAuth } from '../auth';
import {
  annulResults,
  banPlayer,
  changeBan,
  dismissReports,
  openReportCount,
  openReports,
  playerCard,
  renameGroupByModerator,
  renamePlayer,
  resolveReports,
  searchPlayers,
  undoAction,
} from '../moderation';
import { logAction, moderationLog } from '../modlog';
import {
  hiddenQuestions,
  openQuestionReportCount,
  openQuestionReports,
  resolveQuestionReports,
  unhideQuestion,
} from '../questionReports';
import { bankProblem, reloadQuestionBank } from '../questions';
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
import { idParam, parse, requireAdmin, requireRecentPassword } from './common';

/**
 * The moderators' API (/admin): the queues (proposed questions, flags on questions, reports about players), the
 * players, the log of every decision (with undo), and the numbers. What changes anything also wants the password
 * given within the hour (requireRecentPassword).
 */
export const adminRouter = Router();
adminRouter.use('/admin', requireAuth, requireAdmin);
const change = requireRecentPassword;

type Result = { ok: true } | { ok: false; error: string };
const reply = (res: import('express').Response, result: Result, body: () => object = () => ({ ok: true })) => {
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(body());
};

const Basis = z.enum(MODERATION_BASES.map((b) => b.id) as [ModerationBasis, ...ModerationBasis[]], {
  message: 'Избери основание.',
});
const Reason = z.string().max(MODERATION.reasonMax).default('');

adminRouter.get('/admin/summary', (_req, res) => {
  res.json({
    pendingQuestions: pendingCount(),
    openReports: openReportCount(),
    questionReports: openQuestionReportCount(),
  });
});

adminRouter.get('/admin/stats', (_req, res) => {
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
  reply(res, editCommunityQuestion(res.locals.userId, String(req.params.id), draft));
});

/** The bank read again from disk (after a pull of the private bank, without a restart). */
adminRouter.post('/admin/bank/reload', change, (_req, res) => {
  reloadQuestionBank();
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
  const body = parse(z.object({ action: z.enum(['dismiss', 'hide', 'fixed']) }), req, res);
  if (!body) return;
  reply(res, resolveQuestionReports(res.locals.userId, String(req.params.id), body.action), flagsNow);
});

adminRouter.post('/admin/hidden-questions/:id/unhide', change, (req, res) => {
  reply(res, unhideQuestion(String(req.params.id), res.locals.userId), flagsNow);
});

// ─── Reports about players, and the players ──────────────────────────────────

adminRouter.get('/admin/reports', (_req, res) => {
  res.json({ groups: openReports() });
});

const Decision = z.discriminatedUnion('action', [
  z.object({ action: z.literal('dismiss') }),
  z.object({ action: z.literal('rename'), username: z.string().max(40), basis: Basis, reason: Reason }),
  z.object({
    action: z.literal('ban'),
    days: z.number().int().min(1).max(3650).nullable(),
    basis: Basis,
    reason: Reason,
    annul: z.boolean().optional(),
  }),
]);

adminRouter.post('/admin/reports/:id/resolve', change, (req, res) => {
  const decision = parse(Decision, req, res);
  if (!decision) return;
  reply(res, resolveReports(res.locals.userId, idParam(req), decision), () => ({ ok: true, groups: openReports() }));
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
  const body = parse(z.object({ days: z.number().int().min(1).max(3650).nullable(), reason: Reason }), req, res);
  if (!body) return;
  reply(res, changeBan(res.locals.userId, idParam(req), body.days, body.reason), cardOf(req));
});

adminRouter.post('/admin/players/:id/rename', change, (req, res) => {
  const body = parse(z.object({ username: z.string().max(40), basis: Basis, reason: Reason }), req, res);
  if (!body) return;
  reply(res, renamePlayer(res.locals.userId, idParam(req), body), cardOf(req));
});

adminRouter.post('/admin/players/:id/annul', change, (req, res) => {
  const body = parse(z.object({ reason: Reason }), req, res);
  if (!body) return;
  if (body.reason.trim().length < MODERATION.reasonMin) {
    res.status(400).json({ error: `Напиши защо (поне ${MODERATION.reasonMin} знака).` });
    return;
  }
  reply(res, annulResults(res.locals.userId, idParam(req), body.reason), cardOf(req));
});

adminRouter.post('/admin/players/:id/dismiss', change, (req, res) => {
  reply(res, dismissReports(res.locals.userId, idParam(req)), cardOf(req));
});

adminRouter.post('/admin/groups/:id/rename', change, (req, res) => {
  const body = parse(z.object({ basis: Basis, reason: Reason }), req, res);
  if (!body) return;
  reply(res, renameGroupByModerator(res.locals.userId, idParam(req), body.basis, body.reason));
});

// ─── The log ─────────────────────────────────────────────────────────────────

adminRouter.get('/admin/log', (req, res) => {
  const before = Number(req.query.before);
  res.json({ entries: moderationLog(50, Number.isInteger(before) && before > 0 ? before : null) });
});

adminRouter.post('/admin/log/:id/undo', change, (req, res) => {
  reply(res, undoAction(res.locals.userId, idParam(req)), () => ({ ok: true, entries: moderationLog(50) }));
});
