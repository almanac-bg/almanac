import type { RequestHandler } from 'express';
import { config } from './config';

/** The page's websocket origin. CSP's 'self' covers it in current browsers; older Safari needs it spelled out. */
const socketOrigin = new URL(config.appUrl).origin.replace(/^http/, 'ws');

/** Only our own code runs and loads; nothing can frame the site (clickjacking) or inject plugins. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // React and Motion animate through inline style attributes.
  "style-src 'self' 'unsafe-inline'",
  // data: is the film-grain texture in the stylesheet; blob: a picture picked for a set, read before it's made smaller.
  "img-src 'self' data: blob:",
  // Vite inlines the tiniest font subsets as data: URLs.
  "font-src 'self' data:",
  // The confetti library animates in a worker it creates from a blob: URL.
  "worker-src 'self' blob:",
  `connect-src 'self' ${socketOrigin}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const appOrigin = new URL(config.appUrl).origin;

/**
 * Refuses a change sent from another site. The session cookie is SameSite=Lax, so another site's form can't act as the
 * player, but its answer could still sign them out or swap their cookie for a new guest's, and a guest's cookie is the
 * only key to their progress. Browsers say where a request comes from (Sec-Fetch-Site, or at least Origin); a request
 * with neither isn't a page's (Scaleway's notices, a mail app's one-click unsubscribe) and carries no cookie to lose.
 */
export const sameSiteWrites: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const site = req.get('sec-fetch-site');
  const origin = req.get('origin');
  if (site ? site === 'same-origin' || site === 'none' : !origin || origin === appOrigin) return next();
  res.status(403).json({ error: 'Заявката не идва от сайта.' });
};

/** Browser hardening headers on every response. HSTS is set by Caddy, which terminates HTTPS. */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('content-security-policy', CONTENT_SECURITY_POLICY);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  next();
};
