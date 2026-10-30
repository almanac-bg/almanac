import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { dayKey, shiftDay, sofiaHour } from '@quiz/shared';
import { ERASED_BAN_MS, eraseAccount } from './account';
import { moderatorDigest } from './alerts';
import { pruneAnswers } from './answers';
import { purgeOldChallenges, tellExpiredDuels } from './challenges';
import { config } from './config';
import { liveDailyStreak } from './daily';
import { all, db, optimize, prunePreMigrationCopies, run } from './db';
import { eveningStartsAt, retireChampionTitles } from './evening';
import { settleGroupWeeks } from './groups';
import { purgeGuests, purgeRoomGuests } from './guests';
import { inactiveAccountMail, sendMail, streakReminderMail } from './mailer';
import { reportError } from './monitoring';
import { NOTIFICATION_MAX_AGE_MS } from './notifications';
import { dailyReminderPushes, timedPushes } from './push';
import { reloadQuestionBank } from './questions';
import { pruneRecordPlays, tellRecordOwners } from './records';
import { pruneRuns } from './runs';
import { sweepPictures } from './sets';
import { count } from './stats';
import type { UserRow } from './users';

/** Snapshots are taken in the quiet hours, from 04:00 Sofia time (or later that day, after a restart). */
const SNAPSHOT_HOUR = 4;
/** Streak reminders go out in the evening, Sofia time: late enough to matter, early enough to still play. */
const REMINDER_HOURS = [19, 22] as const;
/** Per maintenance run, so a big list doesn't flood the mail provider (and its daily quota) in one go. */
const REMINDERS_PER_RUN = 200;
const SNAPSHOT_NAME = /^quiz-\d{4}-\d{2}-\d{2}\.db$/;

/**
 * Expired login sessions (otherwise only deleted when someone uses them), spent or expired email links, addresses
 * that were never verified once their link is gone, old notifications and day sets — nothing kept longer than it's
 * useful. (Old answers go in batches of their own: pruneAnswers.)
 */
export function purgeExpired(now = Date.now()) {
  run('DELETE FROM sessions WHERE expires_at < ?', now);
  run('DELETE FROM email_tokens WHERE expires_at < ?', now);
  run('DELETE FROM email_tokens WHERE used_at IS NOT NULL');
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
  run('DELETE FROM erased_bans WHERE erased_at < ?', now - ERASED_BAN_MS);
  // An alert's „once a day“ marks (alerts.ts): a week on, nobody asks about that day.
  run("DELETE FROM settings WHERE key LIKE 'alert:%' AND value < ?", shiftDay(dayKey(now), -7));
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
  // The copies taken before a deploy's migrations (db.ts) too.
  prunePreMigrationCopies(now, dir);
  return file;
}

/** How often the upkeep runs, and when a run that hasn't finished counts as stuck (reported, and no longer waited on). */
export const UPKEEP = { everyMs: 15 * 60_000, stuckMs: 30 * 60_000 } as const;

/**
 * The upkeep's steps, each on its own: one that throws is reported and the rest still run (the backup copy last of
 * all, so a broken step before it never stops the backups).
 */
const STEPS: [string, () => unknown][] = [
  ['expired', () => purgeExpired()],
  ['answers', () => pruneAnswers()],
  ['runs', () => pruneRuns()],
  ['guests', () => purgeGuests()],
  [
    'room guests',
    async () => {
      const pupils = await purgeRoomGuests();
      if (pupils) console.log(`🏫 Guests who came for a room, gone for an hour: ${pupils} deleted`);
    },
  ],
  [
    'inactive accounts',
    () => {
      const inactive = retireInactiveAccounts();
      if (inactive.warned || inactive.erased)
        console.log(`🗓️  Unused accounts: ${inactive.warned} warned, ${inactive.erased} deleted`);
    },
  ],
  [
    'streak reminders',
    () => {
      const reminded = sendStreakReminders();
      if (reminded) console.log(`🔥 Streak reminders sent: ${reminded}`);
    },
  ],
  [
    'recordings',
    () => {
      const told = tellRecordOwners();
      if (told) console.log(`📼 Owners of recordings told how they did: ${told}`);
    },
  ],
  ['duels', () => tellExpiredDuels()],
  // The evening champion's title is worn for a day.
  ['champion titles', () => retireChampionTitles()],
  [
    'group weeks',
    async () => {
      const weeks = await settleGroupWeeks();
      if (weeks) console.log(`👑 Groups' weeks settled: ${weeks}`);
    },
  ],
  [
    'pictures',
    () => {
      const pictures = sweepPictures();
      if (pictures) console.log(`🖼️  Pictures no set uses: ${pictures} deleted`);
    },
  ],
  [
    'digest',
    () => {
      if (moderatorDigest()) console.log('🛡️  Morning summary sent to the moderators');
    },
  ],
  ['optimize', () => optimize()],
  [
    'pushes',
    () => {
      const pushed = dailyReminderPushes() + timedPushes((u) => liveDailyStreak(u), eveningStartsAt(dayKey()));
      if (pushed) console.log(`📲 Pushes sent: ${pushed}`);
    },
  ],
  [
    'backup',
    async () => {
      if (sofiaHour() < SNAPSHOT_HOUR) return;
      const file = await snapshot();
      if (file) console.log(`💾 Backup saved: ${file}`);
    },
  ],
];

/** Runs the upkeep every 15 minutes. Returns a stop that resolves once a run in progress (a backup copy) is done. */
export function startMaintenance() {
  let running: Promise<void> | null = null;
  let since = 0;
  const tick = () => {
    // A run that never ended (an await that hangs) would stop every run after it: said once, and left behind.
    if (running && Date.now() - since > UPKEEP.stuckMs) {
      void reportError(
        new Error(`The upkeep has been running for ${Math.round((Date.now() - since) / 60_000)} minutes`),
        'maintenance',
      );
      running = null;
    }
    if (running) return;
    since = Date.now();
    const job = work();
    running = job;
    void job.finally(() => {
      if (running === job) running = null;
    });
  };
  const work = async () => {
    // A write every run even when nobody plays: the daily backup check compares this stamp in the restored copy with
    // the live one (a replica that stopped), and its age with now (an upkeep that stopped); /api/health reads it too.
    try {
      run(
        "INSERT INTO settings (key, value) VALUES ('alive_at', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        String(Date.now()),
      );
    } catch (err) {
      void reportError(err, 'maintenance: alive_at');
    }
    for (const [name, step] of STEPS) {
      try {
        await step();
      } catch (err) {
        void reportError(err, `maintenance: ${name}`);
      }
    }
  };
  const first = setTimeout(tick, 10_000).unref();
  const every = setInterval(tick, UPKEEP.everyMs).unref();
  return async () => {
    clearTimeout(first);
    clearInterval(every);
    await running;
  };
}
