import type { SecondFactorState } from '@quiz/shared';
import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { verifyPassword } from '../auth';
import { ACCOUNT_ONLY } from '../guests';
import { throttled } from '../throttle';
import { getUser, isAdmin, isOwner } from '../users';

/**
 * The body, or a 400 with the first problem in it. Schemas give their messages in Bulgarian; anything they don't word
 * themselves gets a plain fallback rather than Zod's English.
 */
export function parse<T>(schema: z.ZodType<T>, req: Request, res: Response): T | null {
  const parsed = schema.safeParse(req.body, { error: () => 'Невалидни данни.' });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Невалидни данни.' });
    return null;
  }
  return parsed.data;
}

/** For what needs a real account (see ACCOUNT_ONLY): guests are asked to claim theirs first. */
export function requireAccount(_req: Request, res: Response, next: NextFunction) {
  if (getUser(res.locals.userId)?.is_guest) {
    res.status(403).json({ error: ACCOUNT_ONLY });
    return;
  }
  next();
}

export const idParam = (req: Request) => Number(req.params.id);

/** Staff (the owner or a moderator), for what needs no second factor: the count of what waits, setting one up. */
export function requireStaff(_req: Request, res: Response, next: NextFunction) {
  const user = getUser(res.locals.userId);
  if (!user || !isAdmin(user)) {
    res.status(403).json({ error: 'Само за модератори.' });
    return;
  }
  next();
}

/** How long a one-time code given for a session opens /admin. */
const SECOND_FACTOR_MS = 12 * 60 * 60_000;

/**
 * Where a staff member's second factor stands for this session: an authenticator app still to set up, a code to give
 * (none yet, or it's been SECOND_FACTOR_MS), or given.
 */
export function secondFactor(res: Response): SecondFactorState {
  const user = getUser(res.locals.userId);
  if (!user?.totp_on_at) return 'setup';
  const at = res.locals.secondFactorAt as number | null;
  return at && Date.now() - at <= SECOND_FACTOR_MS ? 'ok' : 'needed';
}

/**
 * Staff, with a second factor: a stolen password alone moderates nothing. Without an authenticator app set up the
 * page leads to setting one up (`setup2fa`); without a recent code the app asks for one and tries again (`code`).
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireStaff(req, res, () => {
    const state = secondFactor(res);
    if (state === 'setup') {
      res.status(403).json({ error: 'Първо включи двуфакторното влизане.', setup2fa: true });
      return;
    }
    if (state === 'needed') {
      res.status(403).json({ error: 'Въведи кода от приложението си за удостоверяване.', code: true });
      return;
    }
    next();
  });
}

/** What only the owner does: decide about moderators, reload the bank, read the numbers. */
export function requireOwner(_req: Request, res: Response, next: NextFunction) {
  const user = getUser(res.locals.userId);
  if (!user || !isOwner(user)) {
    res.status(403).json({ error: 'Само за собственика.' });
    return;
  }
  next();
}

/** How long a password given at sign-in, or again (POST /auth/confirm), covers what an admin changes. */
const RECENT_PASSWORD_MS = 60 * 60_000;

/**
 * For what an admin changes (bans, names, questions): the password given within the last hour, so a session left open
 * on a shared computer or copied from one can't do it. The app asks for the password and tries again (`confirm`).
 */
export function requireRecentPassword(_req: Request, res: Response, next: NextFunction) {
  const confirmedAt = res.locals.confirmedAt as number | null;
  if (!confirmedAt || Date.now() - confirmedAt > RECENT_PASSWORD_MS) {
    res.status(403).json({ error: 'Потвърди паролата си, за да продължиш.', confirm: true });
    return;
  }
  next();
}

/**
 * The player's password, given again: to change or remove the email (whoever controls it can reset the password), and
 * to confirm a session for what needs a recent one (/auth/confirm, requireRecentPassword). Ten tries in 15 minutes.
 */
export async function confirmPassword(res: Response, password: string): Promise<boolean> {
  if (throttled(`confirm-password:${res.locals.userId}`, 10, 15 * 60_000)) {
    res.status(429).json({ error: 'Твърде много опити. Изчакай няколко минути.' });
    return false;
  }
  if (!(await verifyPassword(password, getUser(res.locals.userId)!.password_hash))) {
    res.status(400).json({ error: 'Грешна парола.' });
    return false;
  }
  return true;
}
