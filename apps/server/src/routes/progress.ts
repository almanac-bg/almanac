import { isCategoryId } from '@quiz/shared';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { almanacCategory, almanacOverview } from '../almanac';
import { requireAuth, userIdFromRequest } from '../auth';
import { createGroup, groupInfo, groupPreview, joinGroup, leaveGroup, manageGroup, myGroups } from '../groups';
import { network, throttled } from '../throttle';
import { idParam, parse, requireAccount } from './common';

/** „Моят алманах“ and groups: what a player builds up over time. */
export const progress = Router();

// ─── „Моят алманах“ ──────────────────────────────────────────────────────────

progress.get('/almanac', requireAuth, (_req, res) => {
  res.json(almanacOverview(res.locals.userId));
});

progress.get('/almanac/:category', requireAuth, (req, res) => {
  const { category } = req.params;
  if (!isCategoryId(category)) {
    res.status(404).json({ error: 'Няма такава категория.' });
    return;
  }
  res.json(almanacCategory(res.locals.userId, category));
});

// ─── Groups ──────────────────────────────────────────────────────────────────

const inviteCode = (req: Request) => String(req.params.code).slice(0, 16);

function groupReply(res: Response, groupId: number) {
  const info = groupInfo(groupId, res.locals.userId);
  if (!info) {
    res.status(404).json({ error: 'Няма такава група — или вече не си в нея.' });
    return;
  }
  res.json(info);
}

progress.get('/groups', requireAuth, (_req, res) => {
  res.json({ groups: myGroups(res.locals.userId) });
});

progress.post('/groups', requireAuth, requireAccount, (req, res) => {
  const body = parse(z.object({ name: z.string().max(200) }), req, res);
  if (!body) return;
  if (throttled(`group-create:${res.locals.userId}`, 10, 24 * 60 * 60_000)) {
    res.status(429).json({ error: 'Стига нови групи за днес.' });
    return;
  }
  const made = createGroup(res.locals.userId, body.name);
  if (!made.ok) {
    res.status(400).json({ error: made.error });
    return;
  }
  res.json({ id: made.id });
});

/** An invite link as anyone who opens it sees it, signed in or not. */
progress.get('/groups/join/:code', (req, res) => {
  if (throttled(`group-preview:${network(req.ip)}`, 120, 60_000)) {
    res.status(429).json({ error: 'Твърде много заявки.' });
    return;
  }
  const preview = groupPreview(inviteCode(req), userIdFromRequest(req, res));
  if (!preview) {
    res.status(404).json({ error: 'Линкът към групата вече не е валиден. Поискай нов.' });
    return;
  }
  res.json(preview);
});

progress.post('/groups/join/:code', requireAuth, (req, res) => {
  if (throttled(`group-join:${res.locals.userId}`, 30, 60 * 60_000)) {
    res.status(429).json({ error: 'Твърде много опити. Опитай по-късно.' });
    return;
  }
  const joined = joinGroup(res.locals.userId, inviteCode(req));
  if (!joined.ok) {
    res.status(400).json({ error: joined.error });
    return;
  }
  res.json({ id: joined.id });
});

progress.get('/groups/:id', requireAuth, (req, res) => {
  groupReply(res, idParam(req));
});

/** What whoever runs the group may change: its name, its link, who's in it; or delete it. */
function manage(req: Request, res: Response, action: Parameters<typeof manageGroup>[2]) {
  const done = manageGroup(idParam(req), res.locals.userId, action);
  if (!done.ok) {
    res.status(400).json({ error: done.error });
    return false;
  }
  return true;
}

progress.patch('/groups/:id', requireAuth, (req, res) => {
  const body = parse(z.object({ name: z.string().max(200) }), req, res);
  if (body && manage(req, res, { rename: body.name })) groupReply(res, idParam(req));
});

progress.post('/groups/:id/code', requireAuth, (req, res) => {
  if (manage(req, res, { newCode: true })) groupReply(res, idParam(req));
});

progress.delete('/groups/:id/members/:userId', requireAuth, (req, res) => {
  if (manage(req, res, { remove: Number(req.params.userId) })) groupReply(res, idParam(req));
});

progress.delete('/groups/:id', requireAuth, (req, res) => {
  if (manage(req, res, { delete: true })) res.json({ ok: true });
});

progress.post('/groups/:id/leave', requireAuth, (req, res) => {
  leaveGroup(idParam(req), res.locals.userId);
  res.json({ ok: true });
});
