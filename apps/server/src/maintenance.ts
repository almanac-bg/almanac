import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { dayKey, shiftDay, sofiaHour } from '@quiz/shared';
import { eraseAccount } from './account';
import { pruneAnswers } from './answers';
import { purgeOldChallenges, tellExpiredDuels } from './challenges';
import { config } from './config';
import { liveDailyStreak } from './daily';
import { all, db, run } from './db';
import { retireChampionTitles } from './evening';
import { settleGroupWeeks } from './groups';
import { purgeGuests } from './guests';
import { inactiveAccountMail, sendMail, streakReminderMail } from './mailer';
import { reportError } from './monitoring';
import { NOTIFICATION_MAX_AGE_MS } from './notifications';
import { reloadQuestionBank } from './questions';
import { pruneRecordPlays, tellRecordOwners } from './records';
import { pruneRuns } from './runs';
import { count } from './stats';
import type { UserRow } from './users';

/** Snapshots are taken in the quiet hours, from 04:00 Sofia time (or later that day, after a restart). */
const SNAPSHOT_HOUR = 4;
/** Streak reminders go out in the evening, Sofia time: late enough to matter, early enough to still play. */
const REMINDER_HOURS = [19, 22] as const;
/** Per maintenance run, so a big list doesn't flood the mail provider (and its daily quota) in one go. */
const REMINDERS_PER_RUN = 200;
const SNAPSHOT_NAME = /^quiz-\d{4}-\d{2}-\d{2}\.db$/;
/** The copy taken before a deploy's migrations (see db.ts): the way back if that deploy goes wrong. */
const PRE_MIGRATION_NAME = /^quiz-v\d+-before-v\d+\.db$/;
/** …which stops being an option after a month (the privacy policy promises backups forget within 30 days). */
const PRE_MIGRATION_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Expired login sessions (otherwise only deleted when someone uses them), spent or expired email links, addresses
 * that were never verified once their link is gone, old notifications and day sets — nothing kept longer than it's
 * useful. (Old answers go in batches of their own: pruneAnswers.)
 */
export function purgeExpired(now = Date.now()) {
  run('DELETE FROM sessions WHERE expires_at < ?', now);
  run('DELETE FROM email_tokens WHERE expires_at < ? OR used_at IS NOT NULL', now);
  run(
    `UPDATE users SET pending_email = NULL WHERE pending_email IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM email_tokens t WHERE t.user_id = users.id AND t.purpose = 'verify')`,
  );
  run('DELETE FROM quest_progress WHERE day < ?', shiftDay(dayKey(now), -7));
  // A day's frozen set is only read on that day (and a crash-cut run's day after it).
  run('DELETE FROM daily_sets WHERE day < ?', shiftDay(dayKey(now), -7));
  run('DELETE FROM daily_links WHERE day < ?', shiftDay(dayKey(now), -7));
  run('DELETE FROM notifications WHERE created_at < ?', now - NOTIFICATION_MAX_AGE_MS);
  purgeOldChallenges(now);
  pruneRecordPlays(now);
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** An account nobody has signed in to for this long is deleted (the privacy policy says so)… */
export const INACTIVE_MS = 3 * 365 * DAY_MS;
/** …after an email this long before, when it has a verified address to send one to. */
export const INACTIVE_WARNING_MS = 30 * DAY_MS;
/** Per maintenance run: the mail provider's daily quota is shared with everything else. */
const INACTIVE_BATCH = 20;

/**
 * Accounts unused for three years: a warning email a month before (signing in cancels it), then deletion, as for an
 * account deleted from Settings. Without a verified email there's no one to warn. Administrators' accounts are kept.
 * Returns how many were warned and deleted.
 */
export function retireInactiveAccounts(now = Date.now()): { warned: number; erased: number } {
  const warn = all<UserRow>(
    `SELECT * FROM users WHERE is_guest = 0 AND is_admin = 0 AND email IS NOT NULL AND inactivity_warned_at IS NULL
     AND last_seen_at < ? LIMIT ?`,
    now - INACTIVE_MS + INACTIVE_WARNING_MS,
    INACTIVE_BATCH,
  );
  for (const u of warn) {
    run('UPDATE users SET inactivity_warned_at = ? WHERE id = ?', now, u.id);
    sendMail(inactiveAccountMail(u.email!, u.username, now + INACTIVE_WARNING_MS));
  }
  const erase = all<{ id: number }>(
    `SELECT id FROM users WHERE is_guest = 0 AND is_admin = 0 AND last_seen_at < ?
     AND (email IS NULL OR inactivity_warned_at < ?) LIMIT ?`,
    now - INACTIVE_MS,
    now - INACTIVE_WARNING_MS,
    INACTIVE_BATCH,
  );
  for (const { id } of erase) eraseAccount(id);
  if (erase.length) reloadQuestionBank(); // approved questions stop showing their names
  return { warned: warn.length, erased: erase.length };
}

/**
 * Emails players who asked for it when their daily streak (2+ days) breaks at midnight unless they play today.
 * Once a day each; returns how many were sent.
 */
export function sendStreakReminders(now = Date.now()): number {
  const hour = sofiaHour(now);
  if (hour < REMINDER_HOURS[0] || hour > REMINDER_HOURS[1]) return 0;
  const today = dayKey(now);
  // A streak can still be alive a few days back if shields cover the gap; liveDailyStreak decides. Whoever already used
  // today's attempt (and left it at once, so the day didn't count) can't save the streak today: no email.
  const candidates = all<UserRow>(
    `SELECT * FROM users WHERE streak_reminders = 1 AND email IS NOT NULL AND is_guest = 0
     AND last_daily_day >= ? AND last_daily_day < ? AND (reminded_day IS NULL OR reminded_day < ?)
     AND (banned_until IS NULL OR banned_until < ?)
     AND NOT EXISTS (SELECT 1 FROM daily_results d WHERE d.user_id = users.id AND d.day = ?) LIMIT ?`,
    shiftDay(today, -3),
    today,
    today,
    now,
    today,
    REMINDERS_PER_RUN,
  );
  let sent = 0;
  for (const u of candidates) {
    run('UPDATE users SET reminded_day = ? WHERE id = ?', today, u.id);
    const streak = liveDailyStreak(u, today);
    if (streak < 2 || !u.reminder_key) continue;
    const query = `u=${u.id}&k=${encodeURIComponent(u.reminder_key)}`;
    sendMail(
      streakReminderMail(u.email!, u.username, streak, u.streak_shields, {
        page: `${config.appUrl}/unsubscribe?${query}`,
        api: `${config.appUrl}/api/reminders/off?${query}`,
      }),
    );
    sent++;
  }
  count('reminders', sent, today);
  return sent;
}

/**
 * Today's consistent copy of the database (`quiz-2026-10-25.db`), at most one per day; older ones beyond
 * BACKUP_KEEP_DAYS are deleted, and so are pre-migration copies older than a month. Resolves to the new file, or null if there was nothing to do.
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
  const snapshots = fs
    .readdirSync(dir)
    .filter((f) => SNAPSHOT_NAME.test(f))
    .sort();
  for (const old of snapshots.slice(0, -config.backupKeepDays)) fs.rmSync(path.join(dir, old));
  for (const f of fs.readdirSync(dir).filter((f) => PRE_MIGRATION_NAME.test(f))) {
    if (now - fs.statSync(path.join(dir, f)).mtimeMs > PRE_MIGRATION_KEEP_MS) fs.rmSync(path.join(dir, f));
  }
  return file;
}

/** Runs the upkeep every 15 minutes. Returns a stop that resolves once a run in progress (a backup copy) is done. */
export function startMaintenance() {
  let running: Promise<void> | null = null;
  const tick = () => {
    running ??= work().finally(() => {
      running = null;
    });
  };
  const work = async () => {
    try {
      // A write every 15 minutes even when nobody plays: the daily backup check compares this stamp in the restored
      // copy with the live one, so a replica that stopped is caught (deploy/backup-check.sh).
      run(
        "INSERT INTO settings (key, value) VALUES ('alive_at', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        String(Date.now()),
      );
      purgeExpired();
      await pruneAnswers();
      await pruneRuns();
      await purgeGuests();
      const inactive = retireInactiveAccounts();
      if (inactive.warned || inactive.erased)
        console.log(`🗓️  Unused accounts: ${inactive.warned} warned, ${inactive.erased} deleted`);
      const reminded = sendStreakReminders();
      if (reminded) console.log(`🔥 Streak reminders sent: ${reminded}`);
      const told = tellRecordOwners();
      if (told) console.log(`📼 Owners of recordings told how they did: ${told}`);
      tellExpiredDuels();
      // The evening champion's title is worn for a day.
      retireChampionTitles();
      const weeks = settleGroupWeeks();
      if (weeks) console.log(`👑 Groups' weeks settled: ${weeks}`);
      if (sofiaHour() >= SNAPSHOT_HOUR) {
        const file = await snapshot();
        if (file) console.log(`💾 Backup saved: ${file}`);
      }
    } catch (err) {
      void reportError(err, 'maintenance');
    }
  };
  const first = setTimeout(tick, 10_000).unref();
  const every = setInterval(tick, 15 * 60_000).unref();
  return async () => {
    clearTimeout(first);
    clearInterval(every);
    await running;
  };
}
