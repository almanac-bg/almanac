import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BRAND, MODES, PUBLIC_PAGES, pageTitle, ROOM_LIMITS, routeKind, type SiteInfo } from '@quiz/shared';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ServerBusyError, sessionTokenFromCookieHeader } from './auth';
import { challengePreview } from './challenges';
import { config } from './config';
import { dailyPreview } from './daily';
import { db } from './db';
import { groupPreview } from './groups';
import { startMaintenance } from './maintenance';
import { forwardEnvelope, publicDsn, reportError, watchEventLoop } from './monitoring';
import { bankProblem, questionBank } from './questions';
import { createRealtime } from './realtime';
import { api } from './routes/api';
import { sameSiteWrites, securityHeaders } from './security';
import { siteInfo } from './site';
import { seedSkillOnce } from './skill';
import { network, throttled } from './throttle';

questionBank(); // fail fast on a broken question file
seedSkillOnce();

// The last stop wrote that it was clean (shutdown below). Without that, the process was killed: out of memory, a
// crash Node couldn't report, a host reboot. Running matches vanished with it, and nothing else would say so.
{
  const clean = db.prepare("SELECT value FROM settings WHERE key = 'clean_shutdown'").get();
  const alive = db.prepare("SELECT value FROM settings WHERE key = 'alive_at'").get() as { value: string } | undefined;
  if (clean) db.prepare("DELETE FROM settings WHERE key = 'clean_shutdown'").run();
  else if (alive)
    void reportError(new Error('The server restarted without a clean shutdown'), 'unclean restart', {
      extra: { lastAliveAt: new Date(Number(alive.value)).toISOString() },
    });
}

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy (Caddy in Docker) this must trust it, or every visitor shares the proxy's IP.
app.set('trust proxy', config.trustProxy);
app.use(securityHeaders);
app.use('/api', sameSiteWrites);
// A host's question set („Моите въпроси“, up to 50 questions) is the one bigger body there is.
const json = express.json({ limit: '20kb' });
const setJson = express.json({ limit: '128kb' });
app.use((req, res, next) => (/^\/api\/sets(\/\d+)?$/.test(req.path) ? setJson : json)(req, res, next));
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
  // The bank on disk can't be loaded: matches go on with the one loaded before, but a restart would fail.
  if (bankProblem()) {
    res.status(503).json({ ok: false, problem: 'questions' });
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
// An address under /api that isn't one: JSON like every other answer there, not Express's HTML page.
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Няма такъв адрес.' });
});
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

// RFC 9116: where to report a security problem (the repository's SECURITY.md says how it's handled).
app.get('/.well-known/security.txt', (_req, res) => {
  // Valid for a year from now: the standard wants an expiry, and this file is never stale.
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString();
  const lines = [
    // The contact address (it reaches the operator), and GitHub's private vulnerability reports.
    `Contact: mailto:${config.operator.email}`,
    ...(config.sourceUrl ? [`Contact: ${config.sourceUrl}/security/advisories/new`] : []),
    `Expires: ${expires}`,
    'Preferred-Languages: bg, en',
    `Canonical: ${config.appUrl}/.well-known/security.txt`,
    ...(config.sourceUrl ? [`Policy: ${config.sourceUrl}/security/policy`] : []),
  ];
  res.type('text/plain').send(`${lines.join('\n')}\n`);
});

// In production the server also hosts the built web app.
if (fs.existsSync(config.webDist)) {
  const indexHtml = path.join(config.webDist, 'index.html');
  // With error reporting on, the page tells the browser where to report (see apps/web/src/lib/monitoring.ts). What the
  // pages say about the site (who runs it, its source, how many questions) comes with every page (apps/web/src/lib/site.ts).
  const meta = [
    publicDsn && `<meta name="sentry-dsn" content="${publicDsn}" />`,
    publicDsn && config.release && `<meta name="app-release" content="${config.release}" />`,
    `<script type="application/json" id="site">${jsonInHtml(siteInfo)}</script>`,
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
    if (req.path.length > 1 && req.path.endsWith('/')) {
      // Exactly one "/" in front: "//example.com/" (or "/\\example.com/") must not turn into a link to another site.
      const path = `/${req.path.replace(/^[/\\]+/, '').replace(/\/+$/, '')}`;
      return res.redirect(301, path + req.url.slice(req.path.length));
    }
    next();
  });
  app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
  // Each public page with its own title, description and address in the page itself (link previews and search
  // engines read the page, not the app), and the page itself already drawn; the rest of the game says "don't index".
  const drawn = await paintPages();
  const publicPages = new Map(
    Object.entries(PUBLIC_PAGES).map(([route, meta]) => {
      const html = withHead(page, {
        ...meta,
        url: `${config.appUrl}${route === '/' ? '/' : route}`,
        index: true,
        data: route === '/' ? siteData() : undefined,
      });
      const pictured = drawn.get(route);
      const mark = route === '/' ? 'signed-out' : '';
      return [
        route,
        {
          html,
          painted: pictured ? withApp(html, pictured.app, mark) : html,
          returning: pictured?.returning ? withApp(html, pictured.returning, mark, true) : null,
        },
      ];
    }),
  );
  // A screen of the game at its own address: a link to it previews as that address, not the home page.
  const appPage = (at: string) => withHead(page, { index: false, url: `${config.appUrl}${at}` });
  // An address that isn't one says so in the tab too, before the app does.
  const notFoundPage = withHead(page, { title: pageTitle('Страницата не съществува'), index: false });
  app.use((req, res, next) => {
    if (!forPage(req)) return next();
    // The page itself always revalidates, so a new deploy is picked up on the next visit.
    res.setHeader('cache-control', 'no-cache');
    const kind = routeKind(req.path);
    if (kind !== 'public') res.setHeader('x-robots-tag', 'noindex');
    const challenge = /^\/c\/([^/]+)$/.exec(req.path)?.[1];
    if (challenge) {
      // A link that never existed is a 404 (its page says so); an expired one still has a page to show.
      const html = challengePage(page, challenge);
      res
        .status(html ? 200 : 404)
        .type('html')
        .send(html ?? appPage(req.path));
      return;
    }
    const daily = /^\/daily(?:\/([^/]+))?$/.exec(req.path);
    if (daily) {
      res.type('html').send(dailyPage(page, req.path, daily[1] ?? null));
      return;
    }
    const join = /^\/join\/([^/]+)$/.exec(req.path)?.[1];
    if (join) {
      res.type('html').send(joinPage(page, req.path, join));
      return;
    }
    const group = /^\/groups\/join\/([^/]+)$/.exec(req.path)?.[1];
    if (group) {
      res.type('html').send(groupInvitePage(page, req.path, group));
      return;
    }
    const pub = publicPages.get(req.path);
    if (pub) {
      // The landing page is drawn for a visitor without a session (in the version for a device that has signed in
      // before, if it says so); with a session, the app opens the lobby instead.
      if (req.path === '/') res.vary('Cookie');
      const cookie = req.headers.cookie;
      const session = req.path === '/' && sessionTokenFromCookieHeader(cookie) !== null;
      const returning = !!pub.returning && /(?:^|;\s*)quiz_returning=1(?:;|$)/.test(cookie ?? '');
      res.type('html').send(session ? pub.html : returning ? pub.returning! : pub.painted);
      return;
    }
    // A screen of the game (its own title comes with it), or an address that isn't one: the app shows "not found".
    res
      .status(kind === 'app' ? 200 : 404)
      .type('html')
      .send(kind === 'app' ? appPage(req.path) : notFoundPage);
  });
}

/** JSON inside a <script> element: "<" escaped, so no text in it can close the element early. */
function jsonInHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

type Paint = (url: string, site: SiteInfo, version?: { returning: boolean }) => Promise<string>;
/** A public page drawn: the landing page in its two versions (new device, or one that has signed in before). */
type Drawn = Map<string, { app: string; returning?: string }>;

/**
 * The public pages already drawn, by the web app's own renderer (apps/web/src/paint.tsx): once, at startup. Search
 * engines and first visits get the page itself instead of a loading screen. Without the renderer (development) or
 * if it fails, the plain page, which the app draws in the browser.
 */
async function paintPages(): Promise<Drawn> {
  const drawn: Drawn = new Map();
  if (!fs.existsSync(config.webPaint)) return drawn;
  try {
    const { paint } = (await import(pathToFileURL(config.webPaint).href)) as { paint: Paint };
    for (const route of Object.keys(PUBLIC_PAGES)) {
      drawn.set(route, {
        app: await paint(route, siteInfo),
        returning: route === '/' ? await paint(route, siteInfo, { returning: true }) : undefined,
      });
    }
  } catch (err) {
    console.error('🖌️  Drawing the public pages failed: they go out plain.', err);
    void reportError(err, 'drawing the public pages');
  }
  return drawn;
}

/**
 * The page with the app drawn into it, and what the server knew on the root element for the app to hydrate it
 * (lib/painted.ts): `signed-out` on the landing page, and which version of it this is.
 */
function withApp(html: string, app: string, painted: 'signed-out' | '', returning = false): string {
  const known = `data-painted="${painted}"${returning ? ' data-returning="1"' : ''}`;
  // A function, not a string: "$" in the page's text must not read as a replacement pattern.
  return html.replace(/<div id="root"><!--app-->[\s\S]*?<!--\/app--><\/div>/, () => {
    return `<div id="root" ${known}>${app}</div>`;
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
  if (head.data) extra.push(`<script type="application/ld+json">${jsonInHtml(head.data)}</script>`);
  return out.replace('</head>', `${extra.join('')}</head>`);
}

const points = (n: number) => new Intl.NumberFormat('bg-BG').format(n);

/** The day's questions at /daily, or a player's link to them (/daily/<code>): what a link preview shows. */
function dailyPage(html: string, at: string, code: string | null): string {
  const { number, sharer } = dailyPreview(code);
  const of = MODES.daily.questions;
  return withHead(html, {
    ...(sharer
      ? {
          title: `${sharer.user.username}: ${sharer.correct}/${of} на въпросите на деня — можеш ли повече?`,
          description: `Същите ${of} въпроса, един опит, без регистрация. ${BRAND.name} №${number}.`,
        }
      : {
          title: `Въпросите на деня №${number} — ${BRAND.name}`,
          description: `${of} въпроса, едни и същи за цяла България. Три минути, един опит, без регистрация.`,
        }),
    url: `${config.appUrl}${at}`,
    index: false,
  });
}

/** A room's invite link (/join/<code>): who's inviting, while the room is open. */
function joinPage(html: string, at: string, code: string): string {
  const room = realtime.roomPreview(code);
  return withHead(html, {
    title: room ? `${room.host} те кани в стая ${code} — ${BRAND.name}` : `Покана за стая ${code} — ${BRAND.name}`,
    description: `До ${ROOM_LIMITS.maxPlayers[1]} играчи, без регистрация: влизаш с един тап.`,
    url: `${config.appUrl}${at}`,
    index: false,
  });
}

/** A group's invite link (/groups/join/<code>): which group, and what it's for. */
function groupInvitePage(html: string, at: string, code: string): string {
  const group = groupPreview(code.slice(0, 16), null);
  return withHead(html, {
    title: group ? `Покана за групата „${group.name}“ — ${BRAND.name}` : `Покана за група — ${BRAND.name}`,
    description: `Седмична класация на въпросите на деня${group ? ` · ${group.members} в групата` : ''}. Без регистрация: влизаш с един тап.`,
    url: `${config.appUrl}${at}`,
    index: false,
  });
}

/**
 * A challenge link's page with its own title and preview text, so a link pasted into Messenger or Viber reads
 * "Мария те предизвиква…" with the score to beat, not the generic site description.
 */
function challengePage(html: string, id: string): string | null {
  const preview = challengePreview(id);
  if (!preview) return null;
  const name = preview.creator?.username ?? 'Някой';
  // Messenger and Viber often show the title alone: the score to beat goes in it.
  const title =
    preview.topScore !== null && !preview.expired
      ? `${name} те предизвиква: ${points(preview.topScore)} точки за биене`
      : `${name} те предизвиква в ${BRAND.name}`;
  const description = preview.expired
    ? 'Това предизвикателство изтече — но можеш да създадеш свое.'
    : preview.topScore !== null
      ? `Резултатът за биене: ${preview.topScore} точки. 10 въпроса, един опит — можеш ли повече?`
      : '10 въпроса, един опит. Приемаш ли?';
  // A challenge is for the people it's sent to, not for search results.
  return withHead(html, {
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
// Caddy keeps idle connections to us open for a minute or two and reuses them. Node's default (5 s) closes them first,
// and a request Caddy sends on a connection that's just closing fails — Caddy retries a GET, but a POST (sign-up, login)
// becomes a 502. So idle connections stay open longer than the proxy's.
server.keepAliveTimeout = 125_000;
server.headersTimeout = 126_000;
const realtime = createRealtime(server, app.get('trust proxy fn'));
const stopMaintenance = startMaintenance();
watchEventLoop();

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
  // A backup being copied finishes first: closing the database under it would only fail it.
  await stopMaintenance();
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('clean_shutdown', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run(String(Date.now()));
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
