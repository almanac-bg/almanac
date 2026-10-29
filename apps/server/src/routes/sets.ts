import { SETS } from '@quiz/shared';
import express, { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth';
import { fileReport } from '../moderation';
import {
  copySet,
  createSet,
  deleteSet,
  getSet,
  hideSet,
  mySets,
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
    res.status(429).json({ error: 'Стига нови набори за днес.' });
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
    res.json({ id: up.id, w: up.w, h: up.h });
  },
);

/**
 * A set's picture, for the rooms that play it and its editor. Its address is a hash nobody guesses; cached for a day
 * only, so one a moderator blocks soon stops showing, and never by a shared cache.
 */
setsRouter.get('/sets/images/:id', (req, res) => {
  const id = String(req.params.id);
  const file = /^[0-9a-f]{16}$/.test(id) ? pictureFile(id) : undefined;
  if (!file) {
    res.status(404).json({ error: 'Няма такава снимка.' });
    return;
  }
  res.set({
    'Content-Type': file.type,
    'Cache-Control': 'private, max-age=86400',
    'X-Robots-Tag': 'noindex',
    'Content-Security-Policy': "default-src 'none'",
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
    res.status(429).json({ error: 'Стига нови набори за днес.' });
    return;
  }
  const copied = copySet(shareCode(req), res.locals.userId);
  if (!copied.ok) {
    res.status(400).json({ error: copied.error });
    return;
  }
  res.json({ id: copied.id });
});

/** Something wrong with a shared set (offensive, or not what it says): a report about its author, with the link. */
setsRouter.post('/sets/shared/:code/report', requireAuth, requireAccount, (req, res) => {
  const body = parse(z.object({ details: z.string().max(400).default('') }), req, res);
  if (!body) return;
  const code = shareCode(req);
  const preview = sharedPreview(code, res.locals.userId);
  if (!preview?.author) {
    res.status(404).json({ error: 'Този набор вече не е достъпен.' });
    return;
  }
  const details = `Набор „${preview.name}“ (/sets/shared/${code})${body.details.trim() ? `: ${body.details.trim()}` : ''}`;
  const filed = fileReport(res.locals.userId, preview.author, 'other', details);
  if (!filed.ok) {
    res.status(400).json({ error: filed.error });
    return;
  }
  res.json({ ok: true });
});

/** A moderator hides a set a report held up about (or shows it again). */
setsRouter.post('/sets/shared/:code/hide', requireAuth, requireAdmin, requireRecentPassword, (req, res) => {
  const body = parse(z.object({ hidden: z.boolean() }), req, res);
  if (!body) return;
  if (!hideSet(shareCode(req), body.hidden, res.locals.userId)) {
    res.status(404).json({ error: 'Няма такъв набор.' });
    return;
  }
  res.json({ ok: true });
});
