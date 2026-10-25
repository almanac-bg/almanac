import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { dayKey, sofiaHour } from '@quiz/shared';
import { config } from './config';
import { db, run } from './db';

/** Snapshots are taken in the quiet hours, from 04:00 Sofia time (or later that day, after a restart). */
const SNAPSHOT_HOUR = 4;
const SNAPSHOT_NAME = /^quiz-\d{4}-\d{2}-\d{2}\.db$/;

/**
 * Expired login sessions (otherwise only deleted when someone uses them), spent or expired email links, and addresses
 * that were never verified once their link is gone — nothing kept longer than it's useful.
 */
export function purgeExpired(now = Date.now()) {
  run('DELETE FROM sessions WHERE expires_at < ?', now);
  run('DELETE FROM email_tokens WHERE expires_at < ? OR used_at IS NOT NULL', now);
  run(
    `UPDATE users SET pending_email = NULL WHERE pending_email IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM email_tokens t WHERE t.user_id = users.id AND t.purpose = 'verify')`,
  );
}

/**
 * Today's consistent copy of the database (`quiz-2026-10-25.db`), at most one per day; older ones beyond
 * BACKUP_KEEP_DAYS are deleted. Resolves to the new file, or null if there was nothing to do.
 *
 * The copy is made a few hundred pages at a time off the main thread, so live matches don't stall while it runs.
 */
export async function snapshot(now = Date.now(), dir = config.backupDir): Promise<string | null> {
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `quiz-${dayKey(now)}.db`);
  if (fs.existsSync(file)) return null;
  // Write under a temporary name, then rename: a half-written copy never looks like a backup.
  const partial = `${file}.partial`;
  fs.rmSync(partial, { force: true });
  await backup(db, partial, { rate: 256 });
  // A self-contained single file (the live database runs in WAL mode, which a copy inherits).
  const copy = new DatabaseSync(partial);
  copy.exec('PRAGMA journal_mode = DELETE');
  copy.close();
  fs.renameSync(partial, file);
  const snapshots = fs.readdirSync(dir).filter((f) => SNAPSHOT_NAME.test(f)).sort();
  for (const old of snapshots.slice(0, -config.backupKeepDays)) fs.rmSync(path.join(dir, old));
  return file;
}

export function startMaintenance() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      purgeExpired();
      if (sofiaHour() >= SNAPSHOT_HOUR) {
        const file = await snapshot();
        if (file) console.log(`💾 Backup saved: ${file}`);
      }
    } catch (err) {
      console.error('🧹 Maintenance failed:', err);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 10_000).unref();
  setInterval(tick, 15 * 60_000).unref();
}
