import { CLIENT_HEADER, type ClientInfo, parseClient, UPDATE_REQUIRED } from '@almanac/shared';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';

/**
 * A client that speaks a protocol older than its platform's minimum (config.minProtocol). One that says nothing (a
 * tab from before clients said, a script, a health check) is let through: only a client that knows to say it can be
 * held to it.
 */
export const tooOld = (info: ClientInfo | null) => !!info && info.protocol < config.minProtocol[info.client];

/** /api for a client too old to follow it: HTTP 426 with `update-required`, before anything it would misread. */
export function requireProtocol(req: Request, res: Response, next: NextFunction) {
  if (!tooOld(parseClient(req.headers[CLIENT_HEADER]))) return next();
  res.status(426).json({ error: 'Тази версия на играта е остаряла: обнови я.', code: UPDATE_REQUIRED });
}
