import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth';
import { reportQuestion } from '../questionReports';
import { DraftSchema, editSubmission, mySubmissions, submitQuestion, withdrawSubmission } from '../submissions';
import { throttled } from '../throttle';
import { idParam, parse, requireAccount } from './common';

/** Questions players propose, and reports about the bank's questions. */
export const communityRouter = Router();

communityRouter.get('/submissions/mine', requireAuth, (_req, res) => {
  res.json({ submissions: mySubmissions(res.locals.userId) });
});

communityRouter.post('/submissions', requireAuth, requireAccount, (req, res) => {
  const draft = parse(DraftSchema, req, res);
  if (!draft) return;
  const result = submitQuestion(res.locals.userId, draft);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.status(201).json({ submission: result.submission });
});

/** The author changes a question while it waits. */
communityRouter.put('/submissions/:id', requireAuth, requireAccount, (req, res) => {
  const draft = parse(DraftSchema, req, res);
  if (!draft) return;
  const result = editSubmission(res.locals.userId, idParam(req), draft);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ submission: result.submission });
});

/** …or takes it back. */
communityRouter.delete('/submissions/:id', requireAuth, requireAccount, (req, res) => {
  if (!withdrawSubmission(res.locals.userId, idParam(req))) {
    res.status(404).json({ error: 'Няма чакащо предложение с този номер.' });
    return;
  }
  res.json({ ok: true });
});

communityRouter.post('/questions/:id/report', requireAuth, requireAccount, (req, res) => {
  const body = parse(z.object({ reason: z.string(), details: z.string().max(500).default('') }), req, res);
  if (!body) return;
  if (throttled(`question-report:${res.locals.userId}`, 30, 60 * 60_000)) {
    res.status(429).json({ error: 'Твърде много сигнали. Опитай по-късно.' });
    return;
  }
  const result = reportQuestion(res.locals.userId, String(req.params.id), body.reason, body.details);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});
