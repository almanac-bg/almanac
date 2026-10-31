import { type Response, Router } from 'express';
import { z } from 'zod';
import { settleAccount } from '../account';
import { requireAuth } from '../auth';
import {
  acceptFriend,
  blockedPlayers,
  blockPlayer,
  type FriendResult,
  listFriends,
  removeFriend,
  requestFriend,
  unblockPlayer,
} from '../friends';
import { fileReport, playerSubject } from '../moderation';
import { sendFriendsUpdate } from '../notify';
import { throttled } from '../throttle';
import { usernameKey } from '../users';
import { idParam, parse, requireAccount } from './common';

/** Friends, blocking, and reporting a player. */
export const socialRouter = Router();

socialRouter.post('/reports', requireAuth, requireAccount, (req, res) => {
  const body = parse(
    z.object({
      username: z.string().trim().min(1).max(40),
      reason: z.string(),
      details: z.string().max(500).default(''),
    }),
    req,
    res,
  );
  if (!body) return;
  const subject = playerSubject(body.username);
  if (!subject) {
    res.status(400).json({ error: 'Няма такъв играч.' });
    return;
  }
  const result = fileReport(res.locals.userId, subject, body.reason, body.details);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

function friendReply(res: Response, me: number, result: FriendResult) {
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  // Both sides refresh (the actor's other tabs and nav badge too).
  sendFriendsUpdate(result.otherId);
  sendFriendsUpdate(me);
  if (result.accepted) {
    settleAccount(me);
    settleAccount(result.otherId);
  }
  res.json(listFriends(me));
}

socialRouter.get('/friends', requireAuth, (_req, res) => {
  res.json(listFriends(res.locals.userId));
});

socialRouter.post('/friends', requireAuth, requireAccount, (req, res) => {
  const body = parse(z.object({ username: z.string().trim().min(1, 'Въведи име.').max(40) }), req, res);
  if (!body) return;
  // Per sender, and per pair (removing and re-requesting the same player can't become a notification loop).
  const pair = `${res.locals.userId}:${usernameKey(body.username)}`;
  if (
    throttled(`friend-request:${res.locals.userId}`, 30, 60 * 60_000) ||
    throttled(`friend-pair:${pair}`, 3, 24 * 60 * 60_000)
  ) {
    res.status(429).json({ error: 'Твърде много покани. Опитай по-късно.' });
    return;
  }
  friendReply(res, res.locals.userId, requestFriend(res.locals.userId, body.username));
});

socialRouter.post('/friends/:id/accept', requireAuth, requireAccount, (req, res) => {
  friendReply(res, res.locals.userId, acceptFriend(res.locals.userId, idParam(req)));
});

socialRouter.delete('/friends/:id', requireAuth, (req, res) => {
  const other = idParam(req);
  if (removeFriend(res.locals.userId, other)) {
    sendFriendsUpdate(other);
    sendFriendsUpdate(res.locals.userId);
  }
  res.json(listFriends(res.locals.userId));
});

/** Players this one blocked (Settings), and blocking or unblocking one (from a request, a profile, the list). */
socialRouter.get('/blocks', requireAuth, requireAccount, (_req, res) => {
  res.json({ players: blockedPlayers(res.locals.userId) });
});

socialRouter.post('/blocks/:id', requireAuth, requireAccount, (req, res) => {
  // The answer names whoever was blocked: a player's ids walked one by one would name every account (SEC-8).
  if (throttled(`block:${res.locals.userId}`, 30, 60 * 60_000)) {
    res.status(429).json({ error: 'Твърде много опити. Изчакай малко.' });
    return;
  }
  const other = idParam(req);
  const done = blockPlayer(res.locals.userId, other);
  if (!done.ok) {
    res.status(400).json({ error: done.error });
    return;
  }
  sendFriendsUpdate(other);
  sendFriendsUpdate(res.locals.userId);
  res.json({ players: blockedPlayers(res.locals.userId) });
});

socialRouter.delete('/blocks/:id', requireAuth, requireAccount, (req, res) => {
  unblockPlayer(res.locals.userId, idParam(req));
  res.json({ players: blockedPlayers(res.locals.userId) });
});
