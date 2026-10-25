import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { BRAND } from '@quiz/shared';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ServerBusyError } from './auth';
import { challengePreview } from './challenges';
import { config } from './config';
import { forwardEnvelope, publicDsn, reportError } from './monitoring';
import { throttled } from './throttle';
import { db } from './db';
import { startMaintenance } from './maintenance';
import { questionBank } from './questions';
import { createRealtime } from './realtime';
import { api } from './routes/api';
import { securityHeaders } from './security';

questionBank(); // fail fast on a broken question file

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy (Caddy in Docker) this must trust it, or every visitor shares the proxy's IP.
app.set('trust proxy', config.trustProxy);
app.use(securityHeaders);
app.use(express.json({ limit: '20kb' }));
// For uptime monitors: answers only if the database does too.
app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});
// The browser SDK's error reports, passed on to Sentry (see monitoring.ts). Envelopes are plain text, not JSON.
app.post('/api/monitoring', express.text({ type: () => true, limit: '256kb' }), (req, res) => {
  if (throttled(`monitoring:${req.ip}`, 60, 60_000)) {
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
    express.static(path.join(config.webDist, 'assets'), { index: false, maxAge: '1y', immutable: true, fallthrough: false }),
  );
  app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    // HEAD too: uptime monitors often check with it.
    if (!['GET', 'HEAD'].includes(req.method) || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    // The page itself always revalidates, so a new deploy is picked up on the next visit.
    res.setHeader('cache-control', 'no-cache');
    const challenge = /^\/c\/([\w-]{4,16})\/?$/.exec(req.path)?.[1];
    res.type('html').send((challenge && challengePage(page, challenge)) || page);
  });
}

/**
 * A challenge link's page with its own title and preview text, so a link pasted into Messenger or Viber reads
 * "Мария те предизвиква…" with the score to beat, not the generic site description.
 */
function challengePage(html: string, id: string): string | null {
  const preview = challengePreview(id);
  if (!preview) return null;
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const title = esc(`${preview.creator?.username ?? 'Някой'} те предизвиква в ${BRAND.name}`);
  const description = esc(
    preview.expired
      ? 'Това предизвикателство изтече — но можеш да създадеш свое.'
      : preview.topScore !== null
        ? `Резултатът за биене: ${preview.topScore} точки. 10 въпроса, един опит — можеш ли повече?`
        : '10 въпроса, един опит. Приемаш ли?',
  );
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${description}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${description}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${config.appUrl}/c/${id}`);
}

// Last resort: a bug no guard caught. Report it, then exit (state may be broken); Docker restarts the server.
for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(event, (err) => {
    void reportError(err, event).finally(() => process.exit(1));
    setTimeout(() => process.exit(1), 3000).unref();
  });
}

if (config.production && (!config.operator.name || !config.operator.address)) {
  console.warn('⚖️  OPERATOR_NAME and OPERATOR_ADDRESS are not set: the privacy policy and terms show placeholders.');
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
