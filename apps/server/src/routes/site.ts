import { scrubPaths } from '@quiz/shared';
import express, { Router } from 'express';
import { z } from 'zod';
import { emailEventsSecretMatches, handleEmailEvent } from '../emailEvents';
import { reportError } from '../monitoring';
import { siteInfo } from '../site';
import { network, throttled } from '../throttle';

/**
 * What belongs to no account: the operator's details for the legal pages, the mail provider's delivery reports, and
 * errors from browsers.
 */
export const siteRouter = Router();

/** For the privacy policy, terms and footer (works signed out). */
siteRouter.get('/legal', (_req, res) => {
  res.json(siteInfo);
});

/** Delivery reports from the mail provider (see emailEvents.ts); SNS posts them as text/plain. */
siteRouter.post('/email-events/:secret', express.text({ type: () => true, limit: '64kb' }), (req, res, next) => {
  if (!emailEventsSecretMatches(req.params.secret)) return next();
  handleEmailEvent(req.body).then(
    () => res.status(204).end(),
    (err) => {
      void reportError(err, 'email events');
      res.status(204).end();
    },
  );
});

/** Crashes in players' browsers, into the server log: with Sentry off, or before its SDK has loaded in the page. */
siteRouter.post('/client-errors', (req, res) => {
  const body = z
    .object({
      message: z.string().max(500),
      stack: z.string().max(4000).optional(),
      url: z.string().max(300).optional(),
      kind: z.enum(['render', 'error', 'rejection']),
    })
    .safeParse(req.body);
  if (body.success && !throttled(`client-error:${network(req.ip)}`, 20, 10 * 60_000)) {
    // Untrusted text: one line for the message, an indented block for the stack, so it can't forge log entries.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: it strips control characters on purpose (log forging)
    const line = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ');
    const { kind, message, url, stack } = body.data;
    // Only the path, and not whose profile, which room or which link: the log keeps no names or codes.
    const where = scrubPaths(url ?? '?');
    const trace = stack
      ? `\n${stack
          .split('\n')
          .map((l) => `    | ${line(l)}`)
          .join('\n')}`
      : '';
    console.error(`🧯 Browser ${kind} at ${line(where)}: ${line(message)}${trace}`);
  }
  res.status(204).end();
});
