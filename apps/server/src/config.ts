import fs from 'node:fs';
import path from 'node:path';
import { BRAND, DEFAULT_OPEN_QUEUES, isQueueMode, QUEUE_MODES, type QueueModeId } from '@quiz/shared';

const serverRoot = path.resolve(import.meta.dirname, '..');

function seconds(raw: string | undefined, fallback: number): number {
  const n = Number(raw ?? fallback);
  return (Number.isFinite(n) && n >= 0 ? n : fallback) * 1000;
}

function botFillMs(): number | null {
  return process.env.BOT_FILL_SECONDS === 'off' ? null : seconds(process.env.BOT_FILL_SECONDS, 8);
}

const dbPath = process.env.DB_PATH ?? path.join(serverRoot, 'data', 'quiz.db');
const webDist = path.resolve(serverRoot, '../web/dist');

/** The id the web build stamps into its page (see apps/web/vite.config.ts); null without a build (development). */
function webBuild(webDist: string): string | null {
  try {
    const html = fs.readFileSync(path.join(webDist, 'index.html'), 'utf8');
    return /<meta name="app-build" content="([\w-]+)"/.exec(html)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** PUBLIC_QUEUES=duel,royale,trio… ("all" opens every ranked queue). */
function openQueues(): QueueModeId[] {
  const raw = process.env.PUBLIC_QUEUES?.trim();
  if (!raw) return DEFAULT_OPEN_QUEUES;
  if (raw === 'all') return QUEUE_MODES;
  const modes = raw
    .split(',')
    .map((m) => m.trim())
    .filter(isQueueMode);
  return modes.length ? modes : DEFAULT_OPEN_QUEUES;
}

export const config = {
  /** When this process started: a one-attempt run (daily, challenge link) begun before it died with the old process. */
  bootedAt: Date.now(),
  port: Number(process.env.PORT ?? 3001),
  production: process.env.NODE_ENV === 'production',
  dbPath,
  webDist,
  /** Which build of the web app this server hosts: open tabs of an older one reload (see LobbyStats.build). */
  webBuild: webBuild(webDist),
  /** How long a quick-match queue waits for humans before bots fill the empty seats. */
  botFillMs: botFillMs(),
  /** …and how long while someone else is online and free to join: then a person is worth waiting a little for. */
  botFillBusyMs: Math.max(botFillMs() ?? 0, seconds(process.env.BOT_FILL_BUSY_SECONDS, 20)),
  /** Ranked queues players can join; the others stay closed until there are enough people for them. */
  openQueues: openQueues(),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  /** Daily database snapshots ("off" disables). Defaults to a backups folder next to the database. */
  backupDir:
    process.env.BACKUP_DIR === 'off' ? null : (process.env.BACKUP_DIR ?? path.join(path.dirname(dbPath), 'backups')),
  backupKeepDays: Number(process.env.BACKUP_KEEP_DAYS ?? 14),
  /** Express "trust proxy" setting: which proxies may set X-Forwarded-For. */
  trustProxy: process.env.TRUST_PROXY ?? 'loopback',
  sessionDays: 30,
  /** Public origin used in email links. */
  appUrl: (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  /** e.g. smtp://user:pass@smtp-relay.brevo.com:587 — without it, emails are printed to the console. */
  smtpUrl: process.env.SMTP_URL || null,
  mailFrom: process.env.MAIL_FROM || `${BRAND.name} <no-reply@${BRAND.domain}>`,
  /** Tests: write every outgoing email as a JSON file into this directory. */
  mailOutbox: process.env.MAIL_OUTBOX || null,
  /**
   * On shutdown, how long running matches may play out before the process exits. A 15-question Royale takes about
   * five minutes; keep docker-compose's stop_grace_period above this. Development restarts immediately.
   */
  drainMs: Number(process.env.DRAIN_SECONDS ?? (process.env.NODE_ENV === 'production' ? 330 : 0)) * 1000,
  /** Who runs this site: shown in the privacy policy and terms. Personal details live here, not in the code. */
  operator: {
    name: process.env.OPERATOR_NAME || null,
    address: process.env.OPERATOR_ADDRESS || null,
    email: process.env.CONTACT_EMAIL || `privacy@${BRAND.domain}`,
    emailProvider: process.env.EMAIL_PROVIDER || null,
    hosting: process.env.HOSTING_PROVIDER || null,
    backups: process.env.BACKUP_PROVIDER || null,
    inbox: process.env.INBOX_PROVIDER || null,
  },
  /** Where this site's source code is published; linked in the footer (the AGPL asks hosted copies to offer it). */
  sourceUrl: process.env.SOURCE_URL || null,
  /** Error reports go to this Sentry project (EU region recommended); unset, errors only reach the log. */
  sentryDsn: process.env.SENTRY_DSN || null,
  /** Tags error reports with the deployed version (e.g. the git commit). */
  release: process.env.APP_RELEASE || null,
  /** Multiplies every in-game timer. Only for automated tests (e.g. 0.05). */
  gameTimeScale: Number(process.env.GAME_TIME_SCALE ?? 1),
};
