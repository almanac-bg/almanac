import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  dayKey,
  defaultPushPrefs,
  EVENING,
  PUSH,
  PUSH_KINDS,
  type PushKind,
  type PushPrefs,
  sofiaHour,
  TIME_ZONE,
} from '@quiz/shared';
import webpush from 'web-push';
import { z } from 'zod';
import { config } from './config';
import { all, one, run } from './db';
import { reportError } from './monitoring';
import type { UserRow } from './users';

/**
 * Web push: notifications on a player's devices, by their choice (PUSH_KINDS, a daily reminder at their time). At most
 * PUSH.perDay a day, one of each kind, and none at night; what they say also waits in the app's notifications, so a push
 * that isn't sent (quiet hours, the cap) loses nothing. The push services see only an encrypted payload.
 */

if (config.vapid)
  webpush.setVapidDetails(`mailto:${config.operator.email}`, config.vapid.publicKey, config.vapid.privateKey);

export const pushEnabled = () => !!config.vapid;

/**
 * Where a subscription may point: the browsers' own push services (Chrome/Edge/Android, Firefox, Safari/iOS). The
 * server posts to that address, so any other one (an address inside our network, a stranger's server) is refused.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /\.push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];

export const SubscriptionSchema = z.object({
  endpoint: z
    .url({ protocol: /^https$/ })
    .max(1000)
    .refine((url) => PUSH_HOSTS.some((h) => h.test(new URL(url).hostname)), 'Непозната услуга за известия.'),
  keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
});

export const PrefsSchema = z.object({
  daily: z
    .number()
    .int()
    .min(PUSH.dailyFrom)
    .max(PUSH.dailyTo)
    .refine((m) => m % PUSH.dailyStep === 0)
    .nullable(),
  kinds: z.object(Object.fromEntries(PUSH_KINDS.map((k) => [k.id, z.boolean()])) as Record<PushKind, z.ZodBoolean>),
});

export function pushPrefs(row: Pick<UserRow, 'push_prefs'>): PushPrefs | null {
  if (!row.push_prefs) return null;
  const parsed = PrefsSchema.safeParse(JSON.parse(row.push_prefs));
  return parsed.success ? parsed.data : defaultPushPrefs();
}

/** This device gets pushes from now on (its first one sets up the player's choices with the defaults). */
export function subscribe(userId: number, sub: z.infer<typeof SubscriptionSchema>) {
  run(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    sub.endpoint,
    userId,
    sub.keys.p256dh,
    sub.keys.auth,
    Date.now(),
  );
  run('UPDATE users SET push_prefs = COALESCE(push_prefs, ?) WHERE id = ?', JSON.stringify(defaultPushPrefs()), userId);
}

export const unsubscribe = (userId: number, endpoint: string) =>
  run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', userId, endpoint);

export const setPushPrefs = (userId: number, prefs: PushPrefs) =>
  run('UPDATE users SET push_prefs = ? WHERE id = ?', JSON.stringify(prefs), userId);

export const deviceCount = (userId: number) =>
  one<{ n: number }>('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', userId)!.n;

export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap opens (a path in the app). */
  url: string;
  /** Pushes with the same tag replace each other on the device. */
  tag?: string;
}

const quietNow = (now: number) => {
  if (!config.pushQuiet) return false;
  const hour = sofiaHour(now);
  return hour >= PUSH.quietFrom || hour < PUSH.quietUntil;
};

/**
 * Pushes to every device of a player, if they want this kind, it's daytime, it's the first of its kind today and the
 * day's cap isn't reached. `kind` 'daily' is the reminder (asked for by its time); 'hello' the one that confirms a new
 * device (always, and not counted). True when it went out.
 */
export function push(
  userId: number,
  kind: PushKind | 'daily' | 'hello',
  message: PushMessage,
  now = Date.now(),
): boolean {
  if (!config.vapid) return false;
  const subs = all<{ endpoint: string; p256dh: string; auth: string }>(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
    userId,
  );
  if (!subs.length) return false;
  if (kind !== 'hello') {
    const row = one<Pick<UserRow, 'push_prefs'>>('SELECT push_prefs FROM users WHERE id = ?', userId);
    const prefs = row && pushPrefs(row);
    if (!prefs) return false;
    if (kind === 'daily' ? prefs.daily === null : !prefs.kinds[kind]) return false;
    if (quietNow(now)) return false;
    const today = dayKey(now);
    const sent = all<{ kind: string }>('SELECT kind FROM push_sent WHERE user_id = ? AND day = ?', userId, today);
    if (sent.length >= PUSH.perDay || sent.some((s) => s.kind === kind)) return false;
    run(
      `INSERT INTO push_sent (user_id, kind, day) VALUES (?, ?, ?)
       ON CONFLICT (user_id, kind) DO UPDATE SET day = excluded.day`,
      userId,
      kind,
      today,
    );
  }
  const payload = JSON.stringify({ ...message, tag: message.tag ?? kind });
  if (config.pushOutbox) {
    fs.mkdirSync(config.pushOutbox, { recursive: true });
    const name = `${Date.now()}-${randomBytes(3).toString('hex')}.json`;
    fs.writeFileSync(
      path.join(config.pushOutbox, name),
      JSON.stringify({ userId, kind, devices: subs.length, ...JSON.parse(payload) }),
    );
    return true;
  }
  for (const s of subs)
    webpush
      .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
        TTL: 6 * 60 * 60,
        urgency: 'normal',
      })
      .catch((err: { statusCode?: number }) => {
        // Gone (the browser dropped it, the app was removed): forget this device.
        if (err.statusCode === 404 || err.statusCode === 410)
          run('DELETE FROM push_subscriptions WHERE endpoint = ?', s.endpoint);
        else void reportError(err, 'push', { extra: { status: err.statusCode ?? null } });
      });
  return true;
}

const minuteOfDay = (now: number) => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TIME_ZONE,
  })
    .format(now)
    .split(':')
    .map(Number);
  return h * 60 + m;
};

/** The daily reminders whose time has come: whoever hasn't played today's questions yet (maintenance, every 15 min). */
export function dailyReminderPushes(now = Date.now()): number {
  if (!config.vapid) return 0;
  const today = dayKey(now);
  const minute = minuteOfDay(now);
  const due = all<{ id: number; push_prefs: string }>(
    `SELECT u.id, u.push_prefs FROM users u
     WHERE u.push_prefs IS NOT NULL AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM daily_results d WHERE d.user_id = u.id AND d.day = ?)
     AND NOT EXISTS (SELECT 1 FROM push_sent p WHERE p.user_id = u.id AND p.kind = 'daily' AND p.day = ?)
     AND json_extract(u.push_prefs, '$.daily') <= ?`,
    today,
    today,
    minute,
  );
  let sent = 0;
  for (const u of due) {
    const prefs = pushPrefs(u);
    if (prefs?.daily == null || minute < prefs.daily) continue;
    if (
      push(
        u.id,
        'daily',
        {
          title: 'Днешните 10 въпроса те чакат',
          body: 'Около три минути. Една класация за цяла България.',
          url: '/daily',
        },
        now,
      )
    )
      sent++;
  }
  return sent;
}

/** Users who set up push on some device and want `kind`. */
function wanting(kind: PushKind, extra = '', ...args: (string | number)[]) {
  return all<UserRow>(
    `SELECT u.* FROM users u WHERE u.push_prefs IS NOT NULL
     AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM push_sent p WHERE p.user_id = u.id AND p.kind = '${kind}' AND p.day = ?) ${extra}`,
    dayKey(),
    ...args,
  ).filter((u) => pushPrefs(u)?.kinds[kind]);
}

/** Hour of the evening the streak warning goes out from (the email reminder's is later; push respects quiet hours). */
const STREAK_HOUR = 20;
/** The group week's last day (Sunday), from this hour. */
const GROUPS_HOUR = 18;
/** Before the evening Роял starts: the push goes in the last stretch before it (maintenance runs every 15 min). */
const EVENING_LEAD_MS = 15 * 60_000;

/**
 * The pushes that come at a time of day (maintenance, every 15 minutes): the streak about to break, the evening Роял
 * about to start, the group week's last day. `streakOf` and `eveningStart` come from their own modules.
 */
export function timedPushes(streakOf: (u: UserRow) => number, eveningStart: number | null, now = Date.now()): number {
  if (!config.vapid || quietNow(now)) return 0;
  const today = dayKey(now);
  const hour = sofiaHour(now);
  const notPlayed = 'AND NOT EXISTS (SELECT 1 FROM daily_results d WHERE d.user_id = u.id AND d.day = ?)';
  let sent = 0;

  if (hour >= STREAK_HOUR)
    for (const u of wanting('streak', notPlayed, today)) {
      const streak = streakOf(u);
      if (streak < 2) continue;
      if (
        push(
          u.id,
          'streak',
          {
            title: `🔥 Серията ти от ${streak} дни прекъсва в полунощ`,
            body: 'Днешните 10 въпроса още те чакат — около три минути.',
            url: '/daily',
          },
          now,
        )
      )
        sent++;
    }

  if (eveningStart !== null && now >= eveningStart - EVENING_LEAD_MS && now < eveningStart)
    for (const u of wanting('evening'))
      if (
        push(
          u.id,
          'evening',
          {
            title: `🌙 Вечерният Роял започва в ${new Intl.DateTimeFormat('bg-BG', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE }).format(eveningStart)}`,
            body: `До ${EVENING.maxPlayers} души, един шампион на вечерта. Входът се отваря ${EVENING.lobbyMinutes} минути преди това.`,
            url: '/',
          },
          now,
        )
      )
        sent++;

  const sunday = new Date(`${today}T12:00:00Z`).getUTCDay() === 0;
  if (sunday && hour >= GROUPS_HOUR)
    for (const u of wanting(
      'groups',
      `${notPlayed} AND EXISTS (SELECT 1 FROM group_members m WHERE m.user_id = u.id)`,
      today,
    ))
      if (
        push(
          u.id,
          'groups',
          {
            title: '👑 Последен ден от седмицата в групите ти',
            body: 'Днешните въпроси още броят за седмицата. Довечера излиза победителят.',
            url: '/groups',
          },
          now,
        )
      )
        sent++;
  return sent;
}
