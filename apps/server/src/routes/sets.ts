import { MODERATION, MODERATION_BASES, type ModerationBasis, SETS } from '@quiz/shared';
import express, { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth';
import { one } from '../db';
import { fileReport, hideSetByModerator } from '../moderation';
import {
  copySet,
  createSet,
  deleteSet,
  getSet,
  mySets,
  pictureAllowed,
  pictureFile,
  saveSet,
  sharedPreview,
  uploadPicture,
} from '../sets';
import { throttled } from '../throttle';
import { getUser, isAdmin } from '../users';
import { idParam, parse, requireAccount, requireAdmin, requireRecentPassword } from './common';

/** „Моите въпроси“: a host's own question sets for their rooms, and the links they're shared by. */
export const setsRouter = Router();

const shareCode = (req: Request) => String(req.params.code).slice(0, 16);
const admin = (res: Response) => {
  const user = getUser(res.locals.userId);
  return !!user && isAdmin(user);
};

setsRouter.get('/sets', requireAuth, requireAccount, (_req, res) => {
  res.json({ sets: mySets(res.locals.userId) });
});

setsRouter.post('/sets', requireAuth, requireAccount, (req, res) => {
  if (throttled(`set-create:${res.locals.userId}`, 30, 24 * 60 * 60_000)) {
    res.status(429).json({ error: 'Днес направи много нови набори. Утре можеш да продължиш.' });
    return;
  }
  const made = createSet(res.locals.userId, req.body);
  if (!made.ok) {
    res.status(400).json({ error: made.error });
    return;
  }
  res.json({ id: made.id });
});

setsRouter.get('/sets/:id', requireAuth, requireAccount, (req, res) => {
  const set = getSet(idParam(req), res.locals.userId);
  if (!set) {
    res.status(404).json({ error: 'Няма такъв набор.' });
    return;
  }
  res.json(set);
});

setsRouter.put('/sets/:id', requireAuth, requireAccount, (req, res) => {
  if (throttled(`set-save:${res.locals.userId}`, 300, 60 * 60_000)) {
    res.status(429).json({ error: 'Твърде много записвания. Изчакай малко.' });
    return;
  }
  const saved = saveSet(idParam(req), res.locals.userId, req.body);
  if (!saved.ok) {
    res.status(400).json({ error: saved.error });
    return;
  }
  res.json(saved.set);
});

setsRouter.delete('/sets/:id', requireAuth, requireAccount, (req, res) => {
  deleteSet(idParam(req), res.locals.userId);
  res.json({ ok: true });
});

/**
 * A picture for a question: made small enough in the browser (a WebP or a JPEG, without a photo's metadata), checked
 * and kept here. Saved with a set, it's that set's; one no set uses goes after a day (sweepPictures).
 */
setsRouter.post(
  '/sets/images',
  requireAuth,
  requireAccount,
  express.raw({ type: ['image/webp', 'image/jpeg'], limit: SETS.imageBytes }),
  (req, res) => {
    if (throttled(`set-image:${res.locals.userId}`, 120, 60 * 60_000)) {
      res.status(429).json({ error: 'Твърде много снимки наведнъж. Изчакай малко.' });
      return;
    }
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: 'Това не е снимка, която можем да ползваме (WebP или JPEG).' });
      return;
    }
    const up = uploadPicture(res.locals.userId, req.body);
    if (!up.ok) {
      res.status(400).json({ error: up.error });
      return;
    }
    res.json({ id: up.id, w: up.w, h: up.h, url: up.url });
  },
);

/**
 * A set's picture, for the rooms that play it, its editor and a moderator reading it: only by the signed address the
 * server gave them (pictureUrl), until it expires — a picture is no file anyone can link to from elsewhere. Cached for
 * an hour at most, so one a moderator blocks soon stops showing, never by a shared cache, and never by another site.
 */
setsRouter.get('/sets/images/:id', (req, res) => {
  const id = String(req.params.id);
  const allowed = /^[0-9a-f]{16}$/.test(id) && pictureAllowed(id, req.query.e, req.query.s);
  const file = allowed ? pictureFile(id) : undefined;
  if (!file) {
    res.status(404).json({ error: 'Няма такава снимка.' });
    return;
  }
  res.set({
    'Content-Type': file.type,
    'Cache-Control': 'private, max-age=3600',
    'X-Robots-Tag': 'noindex',
    'Content-Security-Policy': "default-src 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.send(Buffer.from(file.bytes));
});

/** A share link as another host sees it. */
setsRouter.get('/sets/shared/:code', requireAuth, (req, res) => {
  const preview = sharedPreview(shareCode(req), res.locals.userId, admin(res));
  if (!preview) {
    res.status(404).json({ error: 'Този набор вече не е достъпен.' });
    return;
  }
  res.json(preview);
});

setsRouter.post('/sets/shared/:code/copy', requireAuth, requireAccount, (req, res) => {
  if (throttled(`set-create:${res.locals.userId}`, 30, 24 * 60 * 60_000)) {
    res.status(429).json({ error: 'Днес направи много нови набори. Утре можеш да продължиш.' });
    return;
  }
  const copied = copySet(shareCode(req), res.locals.userId);
  if (!copied.ok) {
    res.status(400).json({ error: copied.error });
    return;
  }
  res.json({ id: copied.id });
});

/** Something wrong with a shared set (offensive, illegal, not what it says): a report about the set. */
setsRouter.post('/sets/shared/:code/report', requireAuth, requireAccount, (req, res) => {
  const body = parse(z.object({ reason: z.string(), details: z.string().max(400).default('') }), req, res);
  if (!body) return;
  const code = shareCode(req);
  const set = one<{ owner_id: number; name: string; hidden: number }>(
    'SELECT owner_id, name, hidden FROM question_sets WHERE code = ?',
    code,
  );
  if (!set || set.hidden) {
    res.status(404).json({ error: 'Този набор вече не е достъпен.' });
    return;
  }
  const subject = { kind: 'set', id: code, owner: set.owner_id, label: set.name } as const;
  const filed = fileReport(res.locals.userId, subject, body.reason, body.details);
  if (!filed.ok) {
    res.status(400).json({ error: filed.error });
    return;
  }
  res.json({ ok: true });
});

/**
 * A moderator hides a set (on a basis, with a reason its owner reads; every open report about it closes), or shows it
 * again (with why).
 */
setsRouter.post('/sets/shared/:code/hide', requireAuth, requireAdmin, requireRecentPassword, (req, res) => {
  const body = parse(
    z.object({
      hidden: z.boolean(),
      basis: z
        .enum(MODERATION_BASES.map((b) => b.id) as [ModerationBasis, ...ModerationBasis[]])
        .nullable()
        .default(null),
      reason: z.string().max(MODERATION.reasonMax).default(''),
      copies: z.boolean().optional(),
    }),
    req,
    res,
  );
  if (!body) return;
  const done = hideSetByModerator(res.locals.userId, shareCode(req), body.hidden, body);
  if (!done.ok) {
    res.status(done.status ?? 400).json({ error: done.error });
    return;
  }
  res.json({ ok: true });
});
