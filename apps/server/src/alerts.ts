import { dayKey, MODERATION, sofiaHour } from '@quiz/shared';
import { config } from './config';
import { all, one, run } from './db';
import { moderatorMail, sendMail } from './mailer';

/**
 * Moderators hear about what waits for them by email (an admin page nobody opens moderates nothing): at once when
 * something reaches MODERATION.alertAt reports or flags, and every morning a summary of the queues.
 */

const admins = () =>
  all<{ email: string }>(
    'SELECT email FROM users WHERE is_admin = 1 AND email IS NOT NULL AND email_bounced_at IS NULL',
  );

/** Once a day per `key` at most (the same question flagged again is the same alert). */
export function alertModerators(key: string, subject: string, lines: string[], now = Date.now()) {
  const setting = `alert:${key}`;
  const day = dayKey(now);
  if (one('SELECT 1 AS x FROM settings WHERE key = ? AND value = ?', setting, day)) return;
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    setting,
    day,
  );
  for (const { email } of admins()) sendMail(moderatorMail(email, subject, lines, `${config.appUrl}/admin`));
}

/**
 * The morning summary (from MODERATION.digestHour, once a day; maintenance calls it every 15 minutes): what's
 * waiting in each queue, and what the game hid by itself since yesterday. Nothing waiting, no mail.
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
  const waiting = {
    submissions: n("SELECT COUNT(*) AS n FROM question_submissions WHERE status = 'pending'"),
    flags: n("SELECT COUNT(DISTINCT question_id) AS n FROM question_reports WHERE status = 'open'"),
    // One case per reported thing (a player, a group, a set).
    reports: n(
      `SELECT COUNT(*) AS n FROM (SELECT DISTINCT subject_kind, CASE WHEN subject_kind = 'player' THEN target_id
       ELSE subject_id END FROM reports WHERE status = 'open')`,
    ),
    illegal: n("SELECT COUNT(*) AS n FROM reports WHERE status = 'open' AND reason = 'illegal'"),
    autoHidden: n(
      "SELECT COUNT(*) AS n FROM moderation_log WHERE action = 'auto_hide_question' AND undone_at IS NULL AND created_at > ?",
      now - 24 * 60 * 60_000,
    ),
  };
  if (!waiting.submissions && !waiting.flags && !waiting.reports && !waiting.autoHidden) return false;
  // How long the oldest in a queue has waited, when it's more than a day: what's slipping.
  const oldest = (sql: string) => {
    const since = one<{ at: number | null }>(sql)!.at;
    const days = since === null ? 0 : Math.floor((now - since) / (24 * 60 * 60_000));
    return days >= 1 ? ` (най-старото чака ${days === 1 ? '1 ден' : `${days} дни`})` : '';
  };
  const lines = [
    waiting.illegal && `Сигнали за незаконно съдържание: ${waiting.illegal} — първо тях`,
    waiting.submissions &&
      `Предложени въпроси: ${waiting.submissions}${oldest("SELECT MIN(created_at) AS at FROM question_submissions WHERE status = 'pending'")}`,
    waiting.flags &&
      `Въпроси със сигнали: ${waiting.flags}${oldest("SELECT MIN(created_at) AS at FROM question_reports WHERE status = 'open'")}`,
    waiting.reports &&
      `Доклади (играчи, групи, набори): ${waiting.reports}${oldest("SELECT MIN(created_at) AS at FROM reports WHERE status = 'open'")}`,
    waiting.autoHidden && `Скрити от сигналите на играчите (за денонощие): ${waiting.autoHidden}`,
  ].filter((l): l is string => !!l);
  for (const { email } of admins()) sendMail(moderatorMail(email, 'Модерацията днес', lines, `${config.appUrl}/admin`));
  return true;
}
