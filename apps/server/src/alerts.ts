import { dayKey, MODERATION, sofiaHour } from '@almanac/shared';
import { config } from './config';
import { all, one, run } from './db';
import { moderatorMail, sendMail } from './mailer';
import { throttled } from './throttle';
import { reportsVisibleTo, type UserRow } from './users';

/**
 * Moderators hear about what waits for them by email (an admin page nobody opens moderates nothing): at once when
 * something reaches MODERATION.alertAt reports or flags, and every morning a summary of the queues.
 */

const admins = (ownerOnly = false) =>
  all<{ email: string }>(
    `SELECT email FROM users WHERE is_admin = 1 AND email IS NOT NULL AND email_bounced_at IS NULL
     ${ownerOnly ? "AND staff_role = 'owner'" : ''}`,
  );

/** At most this many alert mails an hour, whatever they're about: past it, the morning summary has the rest. */
export const ALERTS_PER_HOUR = 12;
let held = 0;

/**
 * Once a day per `key` at most (the same question flagged again is the same alert), or once an hour (`per`).
 * `ownerOnly`: about staff, which only the owner decides. Past ALERTS_PER_HOUR in an hour, alerts wait for the
 * morning summary, and the next one that goes says how many did (the 31 October review, MOD-3).
 */
export function alertModerators(
  key: string,
  subject: string,
  lines: string[],
  { now = Date.now(), ownerOnly = false, per = 'day' as 'day' | 'hour' } = {},
) {
  const setting = `alert:${key}`;
  const when = per === 'hour' ? `${dayKey(now)} ${sofiaHour(now)}` : dayKey(now);
  if (one('SELECT 1 AS x FROM settings WHERE key = ? AND value = ?', setting, when)) return;
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    setting,
    when,
  );
  if (throttled('moderator-alerts', ALERTS_PER_HOUR, 60 * 60_000)) {
    held++;
    return;
  }
  const more = held ? [`…и още ${held} известия от последния час чакат в /admin и в сутрешното обобщение.`] : [];
  held = 0;
  for (const { email } of admins(ownerOnly))
    sendMail(moderatorMail(email, subject, [...lines, ...more], `${config.appUrl}/admin`));
}

/**
 * The morning summary (from MODERATION.digestHour, once a day; maintenance calls it every 15 minutes): what's
 * waiting in each queue, and what the game hid by itself since yesterday — for each recipient as their queue shows it
 * (a moderator's leaves out reports about staff; the 31 October review, MOD-13), counted in cases, illegal ones too.
 * Nothing waiting for someone, no mail to them.
 */
export function moderatorDigest(now = Date.now()): boolean {
  if (sofiaHour(now) < MODERATION.digestHour) return false;
  const day = dayKey(now);
  if (one("SELECT 1 AS x FROM settings WHERE key = 'mod_digest_day' AND value = ?", day)) return false;
  run(
    "INSERT INTO settings (key, value) VALUES ('mod_digest_day', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    day,
  );
  const n = (sql: string, ...args: number[]) => one<{ n: number }>(sql, ...args)!.n;
  // How long the oldest in a queue has waited, when it's more than a day: what's slipping.
  const oldest = (sql: string) => {
    const since = one<{ at: number | null }>(sql)!.at;
    const days = since === null ? 0 : Math.floor((now - since) / (24 * 60 * 60_000));
    return days >= 1 ? ` (най-старото чака ${days === 1 ? '1 ден' : `${days} дни`})` : '';
  };
  const submissions = n("SELECT COUNT(*) AS n FROM question_submissions WHERE status = 'pending'");
  const flags = n("SELECT COUNT(DISTINCT question_id) AS n FROM question_reports WHERE status = 'open'");
  const autoHidden = n(
    "SELECT COUNT(*) AS n FROM moderation_log WHERE action = 'auto_hide_question' AND undone_at IS NULL AND created_at > ?",
    now - 24 * 60 * 60_000,
  );
  // One case per reported thing (a player, a group, a set), as the queue groups them.
  const CASE = "subject_kind, CASE WHEN subject_kind = 'player' THEN target_id ELSE subject_id END";
  let sent = false;
  for (const staff of all<{ email: string } & Pick<UserRow, 'is_admin' | 'staff_role'>>(
    `SELECT email, is_admin, staff_role FROM users WHERE is_admin = 1 AND email IS NOT NULL AND email_bounced_at IS NULL`,
  )) {
    const visible = reportsVisibleTo(staff);
    const reports = n(
      `SELECT COUNT(*) AS n FROM (SELECT DISTINCT ${CASE} FROM reports r WHERE status = 'open' AND ${visible})`,
    );
    const illegal = n(
      `SELECT COUNT(*) AS n FROM (SELECT DISTINCT ${CASE} FROM reports r
       WHERE status = 'open' AND reason = 'illegal' AND ${visible})`,
    );
    if (!submissions && !flags && !reports && !autoHidden) continue;
    const lines = [
      illegal && `Случаи с незаконно съдържание: ${illegal} — първо тях`,
      submissions &&
        `Предложени въпроси: ${submissions}${oldest("SELECT MIN(created_at) AS at FROM question_submissions WHERE status = 'pending'")}`,
      flags &&
        `Въпроси със сигнали: ${flags}${oldest("SELECT MIN(created_at) AS at FROM question_reports WHERE status = 'open'")}`,
      reports &&
        `Доклади (играчи, групи, набори): ${reports}${oldest(`SELECT MIN(created_at) AS at FROM reports r WHERE status = 'open' AND ${visible}`)}`,
      autoHidden && `Скрити от сигналите на играчите (за денонощие): ${autoHidden}`,
    ].filter((l): l is string => !!l);
    sendMail(moderatorMail(staff.email, 'Модерацията днес', lines, `${config.appUrl}/admin`));
    sent = true;
  }
  return sent;
}
