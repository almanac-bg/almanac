import path from 'node:path';

const serverRoot = path.resolve(import.meta.dirname, '..');

function botFillMs(): number | null {
  const raw = process.env.BOT_FILL_SECONDS;
  if (raw === 'off') return null;
  const seconds = Number(raw ?? 8);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 8000;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  production: process.env.NODE_ENV === 'production',
  dbPath: process.env.DB_PATH ?? path.join(serverRoot, 'data', 'quiz.db'),
  webDist: path.resolve(serverRoot, '../web/dist'),
  /** How long a quick-match queue waits for humans before bots fill the empty seats. */
  botFillMs: botFillMs(),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  /** Express "trust proxy" setting: which proxies may set X-Forwarded-For. */
  trustProxy: process.env.TRUST_PROXY ?? 'loopback',
  sessionDays: 30,
  /** Extra moderators (comma-separated usernames). The first account ever registered is always an admin. */
  adminUsernames: (process.env.ADMIN_USERNAMES ?? '')
    .split(',')
    .map((s) => s.trim().normalize('NFC').toLowerCase())
    .filter(Boolean),
  /** Multiplies every in-game timer. Only for automated tests (e.g. 0.05). */
  gameTimeScale: Number(process.env.GAME_TIME_SCALE ?? 1),
};
