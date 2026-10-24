import fs from 'node:fs';
import path from 'node:path';
import { dayKey, sofiaHour } from '@quiz/shared';
import { config } from './config';
import { db, run } from './db';

/** Snapshots are taken in the quiet hours, from 04:00 Sofia time (or later that day, after a restart). */
const SNAPSHOT_HOUR = 4;
const SNAPSHOT_NAME = /^quiz-\d{4}-\d{2}-\d{2}\.db$/;

/** Expired login sessions and spent email links (sessions are otherwise only deleted when someone uses them). */
export function purgeExpired(now = Date.now()) {
  run('DELETE FROM sessions WHERE expires_at < ?', now);
  run('DELETE FROM email_tokens WHERE expires_at < ?', now - 7 * 24 * 60 * 60_000);
}

/**
 * Today's consistent copy of the database (`quiz-2026-10-25.db`), at most one per day; older ones beyond
 * BACKUP_KEEP_DAYS are deleted. Returns the new file, or null if there was nothing to do.
 */
export function snapshot(now = Date.now(), dir = config.backupDir): string | null {
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `quiz-${dayKey(now)}.db`);
  if (fs.existsSync(file)) return null;
  // Write under a temporary name, then rename: a half-written copy never looks like a backup.
  const partial = `${file}.partial`;
  fs.rmSync(partial, { force: true });
  db.exec(`VACUUM INTO '${partial.replaceAll("'", "''")}'`);
  fs.renameSync(partial, file);
  const snapshots = fs.readdirSync(dir).filter((f) => SNAPSHOT_NAME.test(f)).sort();
  for (const old of snapshots.slice(0, -config.backupKeepDays)) fs.rmSync(path.join(dir, old));
  return file;
}

export function startMaintenance() {
  const tick = () => {
    try {
      purgeExpired();
      if (sofiaHour() >= SNAPSHOT_HOUR) {
        const file = snapshot();
        if (file) console.log(`💾 Backup saved: ${file}`);
      }
    } catch (err) {
      console.error('🧹 Maintenance failed:', err);
    }
  };
  setTimeout(tick, 10_000).unref();
  setInterval(tick, 15 * 60_000).unref();
}
