import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { BRAND, PUBLIC_PAGES, routeKind } from '@quiz/shared';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ServerBusyError } from './auth';
import { challengePreview } from './challenges';
import { config } from './config';
import { db } from './db';
import { startMaintenance } from './maintenance';
import { forwardEnvelope, publicDsn, reportError } from './monitoring';
import { questionBank } from './questions';
import { createRealtime } from './realtime';
import { api } from './routes/api';
import { securityHeaders } from './security';
import { network, throttled } from './throttle';

questionBank(); // fail fast on a broken question file

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy (Caddy in Docker) this must trust it, or every visitor shares the proxy's IP.
app.set('trust proxy', config.trustProxy);
app.use(securityHeaders);
app.use(express.json({ limit: '20kb' }));
/** Below this much free space on the database's disk, writes are about to start failing (and backups with them). */
const MIN_FREE_DISK = 256 * 1024 * 1024;

function freeDisk(): number | null {
  try {
    const s = fs.statfsSync(path.dirname(config.dbPath));
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

// For uptime monitors: answers only if the database does too, and its disk has room. A read alone stays green on a
// full disk, while every match result fails to save.
app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
  } catch {
    res.status(503).json({ ok: false, problem: 'database' });
    return;
  }
  const free = freeDisk();
  if (free !== null && free < MIN_FREE_DISK) {
    res.status(503).json({ ok: false, problem: 'disk' });
    return;
  }
  res.json({ ok: true });
});
// The browser SDK's error reports, passed on to Sentry (see monitoring.ts). Envelopes are plain text, not JSON.
app.post('/api/monitoring', express.text({ type: () => true, limit: '256kb' }), (req, res) => {
  if (throttled(`monitoring:${network(req.ip)}`, 20, 60_000)) {
    res.status(429).end();
    return;
  }
  res.status(typeof req.body === 'string' && forwardEnvelope(req.body) ? 200 : 400).end();
});
app.use('/api', api);
// Anything a route throws: a short JSON answer, never Express's HTML page or a stack trace.
app.use('/api', (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ServerBusyError) {
    res.status(503).json({ error: err.message });
    return;
  }
  // Malformed JSON bodies and the like.
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: 'Невалидна заявка.' });
    return;
  }
  void reportError(err, `${req.method} ${req.route?.path ?? req.path}`, { userId: res.locals.userId });
  res.status(500).json({ error: 'Нещо се обърка. Опитай пак.' });
});

// In production the server also hosts the built web app.
if (fs.existsSync(config.webDist)) {
  const indexHtml = path.join(config.webDist, 'index.html');
  // With error reporting on, the page tells the browser where to report (see apps/web/src/lib/monitoring.ts).
  const meta = [
    publicDsn && `<meta name="sentry-dsn" content="${publicDsn}" />`,
    publicDsn && config.release && `<meta name="app-release" content="${config.release}" />`,
  ].filter(Boolean);
  const page = fs.readFileSync(indexHtml, 'utf8').replace('</head>', `${meta.join('')}</head>`);
  // Build files carry a content hash in their name, so they can be cached for good. A missing one is a 404,
  // never the page (a tab from an older deploy then reloads instead of running HTML as JavaScript).
  app.use(
    '/assets',
    express.static(path.join(config.webDist, 'assets'), {
      index: false,
      maxAge: '1y',
      immutable: true,
      fallthrough: false,
    }),
  );
  // HEAD too: uptime monitors often check with it.
  const forPage = (req: Request) =>
    ['GET', 'HEAD'].includes(req.method) && !req.path.startsWith('/api') && !req.path.startsWith('/socket.io');
  // One address per page: search engines would count "/index.html" and "/privacy/" as pages of their own.
  app.use((req, res, next) => {
    if (!forPage(req)) return next();
    if (req.path === '/index.html') return res.redirect(301, '/');
    if (req.path.length > 1 && req.path.endsWith('/'))
      return res.redirect(301, req.path.replace(/\/+$/, '') + req.url.slice(req.path.length));
    next();
  });
  app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
  // Each public page with its own title, description and address in the page itself (link previews and search
  // engines read the page, not the app); the rest of the game says "don't index".
  const publicPages = new Map(
    Object.entries(PUBLIC_PAGES).map(([route, meta]) => [
      route,
      withHead(page, {
        ...meta,
        url: `${config.appUrl}${route === '/' ? '/' : route}`,
        index: true,
        data: route === '/' ? siteData() : undefined,
      }),
    ]),
  );
  const appPage = withHead(page, { index: false });
  app.use((req, res, next) => {
    if (!forPage(req)) return next();
    // The page itself always revalidates, so a new deploy is picked up on the next visit.
    res.setHeader('cache-control', 'no-cache');
    const kind = routeKind(req.path);
    if (kind !== 'public') res.setHeader('x-robots-tag', 'noindex');
    const challenge = /^\/c\/([^/]+)$/.exec(req.path)?.[1];
    if (challenge) {
      // A link that never existed is a 404 (its page says so); an expired one still has a page to show.
      const html = challengePage(appPage, challenge);
      res
        .status(html ? 200 : 404)
        .type('html')
        .send(html ?? appPage);
      return;
    }
    const pub = publicPages.get(req.path);
    if (pub) {
      res.type('html').send(pub);
      return;
    }
    // A screen of the game (its own title comes with it), or an address that isn't one: the app shows "not found".
    res
      .status(kind === 'app' ? 200 : 404)
      .type('html')
      .send(appPage);
  });
}

/**
 * What the home page tells search engines about the site, as structured data: its name (the one shown above a search
 * result instead of the bare domain) and who runs it. Only the WebSite type: a game's own type (VideoGame) asks for
 * ratings, and without them Search Console would list it as an error.
 */
function siteData() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: BRAND.name,
    alternateName: [BRAND.domain, 'Almanac'],
    url: `${config.appUrl}/`,
    inLanguage: 'bg',
    description: PUBLIC_PAGES['/'].description,
    ...(config.operator.name && { publisher: { '@type': 'Person', name: config.operator.name } }),
  };
}

/** The page with this title, description and address in its head; `index` says whether search engines may list it. */
function withHead(
  html: string,
  head: { title?: string; description?: string; url?: string; index: boolean; data?: object },
): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  let out = html;
  if (head.title) {
    const title = esc(head.title);
    out = out
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`);
  }
  if (head.description) {
    const description = esc(head.description);
    out = out
      .replace(/(<meta name="description" content=")[^"]*/, `$1${description}`)
      .replace(/(<meta property="og:description" content=")[^"]*/, `$1${description}`);
  }
  const extra = [
    head.index
      ? '<meta name="robots" content="index, follow, max-image-preview:large" />'
      : '<meta name="robots" content="noindex" />',
  ];
  if (head.url) {
    out = out.replace(/(<meta property="og:url" content=")[^"]*/, `$1${esc(head.url)}`);
    // Only on pages to be listed: a canonical address on a "noindex" page is a mixed signal.
    if (head.index) extra.push(`<link rel="canonical" href="${esc(head.url)}" />`);
  }
  // "<" escaped, so no text in it can close the script early.
  if (head.data)
    extra.push(`<script type="application/ld+json">${JSON.stringify(head.data).replace(/</g, '\\u003c')}</script>`);
  return out.replace('</head>', `${extra.join('')}</head>`);
}

/**
 * A challenge link's page with its own title and preview text, so a link pasted into Messenger or Viber reads
 * "Мария те предизвиква…" with the score to beat, not the generic site description.
 */
function challengePage(html: string, id: string): string | null {
  const preview = challengePreview(id);
  if (!preview) return null;
  const title = `${preview.creator?.username ?? 'Някой'} те предизвиква в ${BRAND.name}`;
  const description = preview.expired
    ? 'Това предизвикателство изтече — но можеш да създадеш свое.'
    : preview.topScore !== null
      ? `Резултатът за биене: ${preview.topScore} точки. 10 въпроса, един опит — можеш ли повече?`
      : '10 въпроса, един опит. Приемаш ли?';
  // `html` already says noindex: a challenge is for the people it's sent to, not for search results.
  return withHead(html.replace(/<meta name="robots"[^>]*>/, ''), {
    title,
    description,
    url: `${config.appUrl}/c/${encodeURIComponent(preview.id)}`,
    index: false,
  });
}

// Last resort: a bug no guard caught. Report it, then exit (state may be broken); Docker restarts the server.
for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(event, (err) => {
    void reportError(err, event).finally(() => process.exit(1));
    setTimeout(() => process.exit(1), 3000).unref();
  });
}

// A public service must say who runs it (GDPR чл. 13: the identity and contact details; the name and CONTACT_EMAIL
// are those). A postal address is optional: ЗЕТ чл. 4 asks for one from services provided for remuneration, which a
// free game without ads is not. No launching with a placeholder in the legal pages.
if (config.production && !config.operator.name) {
  console.error('⚖️  Set OPERATOR_NAME (see .env.example): the privacy policy and terms say who runs the site.');
  process.exit(1);
}
if (config.production && config.gameTimeScale !== 1) {
  console.warn(`⏱️  GAME_TIME_SCALE is ${config.gameTimeScale}: every timer in every match runs at that speed.`);
}

const server = http.createServer(app);
const realtime = createRealtime(server);
startMaintenance();

server.listen(config.port, () => {
  console.log(`⚡ ${BRAND.name} server on http://localhost:${config.port}`);
});

/**
 * Graceful restart (e.g. a deploy): no new matches start, queued players are told why, running matches play out
 * (up to DRAIN_SECONDS), then the process exits. A second signal stops at once.
 */
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) process.exit(0);
  stopping = true;
  const live = realtime.activeGames();
  if (live && config.drainMs) console.log(`⏳ ${signal}: letting ${live} live match(es) finish before stopping…`);
  await realtime.drain(config.drainMs);
  realtime.io.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
