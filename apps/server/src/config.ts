import path from 'node:path';
import { BRAND } from '@quiz/shared';

const serverRoot = path.resolve(import.meta.dirname, '..');

function botFillMs(): number | null {
  const raw = process.env.BOT_FILL_SECONDS;
  if (raw === 'off') return null;
  const seconds = Number(raw ?? 8);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 8000;
}

const dbPath = process.env.DB_PATH ?? path.join(serverRoot, 'data', 'quiz.db');

export const config = {
  port: Number(process.env.PORT ?? 3001),
  production: process.env.NODE_ENV === 'production',
  dbPath,
  webDist: path.resolve(serverRoot, '../web/dist'),
  /** How long a quick-match queue waits for humans before bots fill the empty seats. */
  botFillMs: botFillMs(),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  /** Daily database snapshots ("off" disables). Defaults to a backups folder next to the database. */
  backupDir: process.env.BACKUP_DIR === 'off' ? null : (process.env.BACKUP_DIR ?? path.join(path.dirname(dbPath), 'backups')),
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
  /** Moderators (comma-separated usernames). In development the first account ever registered is one too. */
  adminUsernames: (process.env.ADMIN_USERNAMES ?? '')
    .split(',')
    .map((s) => s.trim().normalize('NFC').toLowerCase())
    .filter(Boolean),
  /** Multiplies every in-game timer. Only for automated tests (e.g. 0.05). */
  gameTimeScale: Number(process.env.GAME_TIME_SCALE ?? 1),
};
