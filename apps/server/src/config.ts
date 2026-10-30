import fs from 'node:fs';
import path from 'node:path';
import { BRAND, DEFAULT_OPEN_QUEUES, EVENING, isQueueMode, QUEUE_MODES, type QueueModeId } from '@quiz/shared';
import { z } from 'zod';

const serverRoot = path.resolve(import.meta.dirname, '..');

// The settings that are numbers. A blank one counts as unset (docker compose passes `VAR=` for those it doesn't set).
const unsetIfBlank = (v: unknown) => (v === '' ? undefined : v);
const number = (min: number, max: number) => z.preprocess(unsetIfBlank, z.coerce.number().min(min).max(max).optional());
const Numbers = z.object({
  PORT: z.preprocess(unsetIfBlank, z.coerce.number().int().min(1).max(65_535).optional()),
  BOT_FILL_SECONDS: z.preprocess(
    unsetIfBlank,
    z.union([z.literal('off'), z.coerce.number().min(0).max(600)]).optional(),
  ),
  BOT_FILL_BUSY_SECONDS: number(0, 600),
  BACKUP_KEEP_DAYS: number(1, 3650),
  DRAIN_SECONDS: number(0, 3600),
  GAME_TIME_SCALE: number(0.01, 10),
});

/**
 * A typo here (GAME_TIME_SCALE=0,15, PORT=abc) used to become NaN — matches that end in milliseconds, a random port,
 * backups kept forever. Now the server doesn't start, and says which setting is wrong.
 */
function numbers() {
  const parsed = Numbers.safeParse(process.env);
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')} (${issue.message})`).join(', ');
  throw new Error(`Invalid setting: ${problems}. Fix it in .env (see .env.example).`);
}
const env = numbers();

const botFillMs = env.BOT_FILL_SECONDS === 'off' ? null : (env.BOT_FILL_SECONDS ?? 8) * 1000;

const dbPath = process.env.DB_PATH ?? path.join(serverRoot, 'data', 'quiz.db');
const webDist = path.resolve(serverRoot, '../web/dist');
/** The web app's renderer for the pages the server sends already drawn (apps/web/src/paint.tsx). */
const webPaint = path.resolve(serverRoot, '../web/dist-ssr/paint.mjs');

/** The id the web build stamps into its page (see apps/web/vite.config.ts); null without a build (development). */
function webBuild(webDist: string): string | null {
  try {
    const html = fs.readFileSync(path.join(webDist, 'index.html'), 'utf8');
    return /<meta name="app-build" content="([\w-]+)"/.exec(html)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** A link for the page (the footer offers it): https only, so a typo can't put a `javascript:` URL there. */
function httpsUrl(raw: string | undefined): string | null {
  const url = raw ? URL.parse(raw) : null;
  return url?.protocol === 'https:' ? url.href.replace(/\/$/, '') : null;
}

/**
 * PUBLIC_QUEUES=duel,royale,squad… ("all", or unset: every ranked queue). A typo stops the server: it would close a
 * queue. "trio" (merged into Арена) still reads as Арена, so an old setting doesn't keep the server down.
 */
function openQueues(): QueueModeId[] {
  const raw = process.env.PUBLIC_QUEUES?.trim();
  if (!raw) return DEFAULT_OPEN_QUEUES;
  if (raw === 'all') return QUEUE_MODES;
  const names = [...new Set(raw.split(',').map((m) => (m.trim() === 'trio' ? 'squad' : m.trim())))];
  const unknown = names.filter((m) => !isQueueMode(m));
  if (unknown.length)
    throw new Error(
      `Invalid setting: PUBLIC_QUEUES has ${unknown.join(', ')}; use "all" or ${QUEUE_MODES.join(', ')}.`,
    );
  return names.filter(isQueueMode);
}

/**
 * When the evening Роял starts, Sofia time: EVENING_AT=21:00 (the default), or with seconds for tests ("13:05:30");
 * "off" turns it off. A typo stops the server.
 */
function eveningAt(): { hour: number; minute: number; second: number } | null {
  const raw = process.env.EVENING_AT?.trim();
  if (!raw) return { hour: EVENING.hour, minute: 0, second: 0 };
  if (raw === 'off') return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  const [hour, minute, second] = m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : [NaN, NaN, NaN];
  if (!(hour <= 23 && minute <= 59 && second <= 59))
    throw new Error(`Invalid setting: EVENING_AT is "${raw}"; use HH:MM (Sofia time) or "off".`);
  return { hour, minute, second };
}

export const config = {
  /** When this process started: a one-attempt run (daily, challenge link) begun before it died with the old process. */
  bootedAt: Date.now(),
  port: env.PORT ?? 3001,
  production: process.env.NODE_ENV === 'production',
  dbPath,
  webDist,
  webPaint,
  /** Which build of the web app this server hosts: open tabs of an older one reload (see LobbyStats.build). */
  webBuild: webBuild(webDist),
  /** How long a quick-match queue waits for humans before bots fill the empty seats. */
  botFillMs,
  /** …and how long while someone else is online and free to join: then a person is worth waiting a little for. */
  botFillBusyMs: Math.max(botFillMs ?? 0, (env.BOT_FILL_BUSY_SECONDS ?? 20) * 1000),
  /** Ranked queues players can join; the others stay closed until there are enough people for them. */
  openQueues: openQueues(),
  /** When the evening Роял starts each day (null: never). */
  eveningAt: eveningAt(),
  // Secure cookies whenever the site is served over HTTPS, unless COOKIE_SECURE says otherwise.
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : (process.env.APP_URL ?? '').startsWith('https:'),
  /** Daily database snapshots ("off" disables). Defaults to a backups folder next to the database. */
  backupDir:
    process.env.BACKUP_DIR === 'off' ? null : (process.env.BACKUP_DIR ?? path.join(path.dirname(dbPath), 'backups')),
  // Each is a full copy on the database's own disk; older points in time are Litestream's (14 days, off the server).
  backupKeepDays: env.BACKUP_KEEP_DAYS ?? 3,
  /** Express "trust proxy" setting: which proxies may set X-Forwarded-For. */
  trustProxy: process.env.TRUST_PROXY ?? 'loopback',
  sessionDays: 30,
  /** Public origin used in email links. */
  appUrl: (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  /** e.g. smtp://PROJECT_ID:SECRET_KEY@smtp.tem.scaleway.com:587 — without it, emails are printed to the console. */
  smtpUrl: process.env.SMTP_URL || null,
  mailFrom: process.env.MAIL_FROM || `${BRAND.name} <no-reply@${BRAND.domain}>`,
  /**
   * The secret in the address Scaleway posts delivery reports to (/api/email-events/<secret>); unset, it's off. 32
   * characters or more (`openssl rand -hex 16`): the address is all that keeps forged reports out.
   */
  emailEventsSecret: process.env.EMAIL_EVENTS_SECRET || null,
  /** Tests: write every outgoing email as a JSON file into this directory. */
  mailOutbox: process.env.MAIL_OUTBOX || null,
  /** Tests: pushes are written here (one JSON file each) instead of sent to the push services. */
  pushOutbox: process.env.PUSH_OUTBOX || null,
  /** Tests (at any hour): PUSH_QUIET=off lifts the night's silence. */
  pushQuiet: process.env.PUSH_QUIET !== 'off',
  /**
   * On shutdown, how long running matches may play out before the process exits. A 15-question Royale takes about
   * five minutes; keep docker-compose's stop_grace_period above this. Development restarts immediately.
   */
  drainMs: (env.DRAIN_SECONDS ?? (process.env.NODE_ENV === 'production' ? 330 : 0)) * 1000,
  /** Who runs this site: shown in the privacy policy and terms. Personal details live here, not in the code. */
  operator: {
    name: process.env.OPERATOR_NAME || null,
    address: process.env.OPERATOR_ADDRESS || null,
    email: process.env.CONTACT_EMAIL || `privacy@${BRAND.domain}`,
    emailProvider: process.env.EMAIL_PROVIDER || null,
    hosting: process.env.HOSTING_PROVIDER || null,
    proxy: process.env.PROXY_PROVIDER || null,
    backups: process.env.BACKUP_PROVIDER || null,
    inbox: process.env.INBOX_PROVIDER || null,
    mailbox: process.env.MAILBOX_PROVIDER || null,
  },
  /** Where this site's source code is published; linked in the footer (the AGPL asks hosted copies to offer it). */
  sourceUrl: httpsUrl(process.env.SOURCE_URL),
  /**
   * Web push (push.ts): the VAPID key pair this site signs its pushes with (`cli.mjs vapid-keys` makes one). Unset: no
   * push, and Settings doesn't offer it.
   */
  vapid:
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
      ? { publicKey: process.env.VAPID_PUBLIC_KEY.trim(), privateKey: process.env.VAPID_PRIVATE_KEY.trim() }
      : null,
  /** Error reports go to this Sentry project (EU region recommended); unset, errors only reach the log. */
  sentryDsn: process.env.SENTRY_DSN || null,
  /** With SENTRY_DSN in production, the server's log goes to the same project too (monitoring.ts → shipLogs); "off" doesn't. */
  sentryLogs: process.env.SENTRY_LOGS !== 'off',
  /** Tags error reports with the deployed version (e.g. the git commit). */
  release: process.env.APP_RELEASE || null,
  /** Multiplies every in-game timer. Only for automated tests (e.g. 0.05). */
  gameTimeScale: env.GAME_TIME_SCALE ?? 1,
};
