import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { ACCOUNT_ONLY } from '../guests';
import { getUser } from '../users';

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
