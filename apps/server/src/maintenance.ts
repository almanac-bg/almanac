import { run } from './db';

const HOUR = 60 * 60_000;

/** Expired login sessions and spent email links (sessions are otherwise only deleted when someone uses them). */
export function purgeExpired(now = Date.now()) {
  run('DELETE FROM sessions WHERE expires_at < ?', now);
  run('DELETE FROM email_tokens WHERE expires_at < ?', now - 7 * 24 * HOUR);
}

export function startMaintenance() {
  const tick = () => {
    try {
      purgeExpired();
    } catch (err) {
      console.error('🧹 Maintenance failed:', err);
    }
  };
  setTimeout(tick, 10_000).unref();
  setInterval(tick, HOUR).unref();
}
