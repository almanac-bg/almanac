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
} from '@almanac/shared';
import webpush from 'web-push';
import { z } from 'zod';
import { config } from './config';
import { afterCommit, all, one, run } from './db';
import { guarded } from './guard';
import { reportError } from './monitoring';
import { type NativeMessage, type Sent, sendApns, sendFcm } from './nativePush';
import type { UserRow } from './users';

/**
 * Pushes: notifications on a player's devices, by their choice (PUSH_KINDS, a daily reminder at their time) — a
 * browser's (web push) and the apps' (nativePush.ts). At most PUSH.perDay a day, one of each kind, and none at night;
 * what they say also waits in the app's notifications, so a push that isn't sent (quiet hours, the cap) loses nothing.
 * A browser's push service sees only an encrypted payload; Apple's and Google's read theirs, which names nobody.
 */

if (config.vapid)
  webpush.setVapidDetails(`mailto:${config.operator.email}`, config.vapid.publicKey, config.vapid.privateKey);

/** Web push is set up (the VAPID keys): Settings offers it in the browser. */
export const pushEnabled = () => !!config.vapid;

export type DevicePlatform = 'ios' | 'android';
/** An app's pushes are set up: Apple's service for iOS, Google's for Android. */
export const nativePushFor = (platform: DevicePlatform) => (platform === 'ios' ? !!config.apns : !!config.fcm);
const anyPush = () => !!(config.vapid || config.apns || config.fcm);

/** The player has a device pushes can reach: a browser's subscription or an app's (in SQL, for `u`, a user row). */
const HAS_DEVICE = `(EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = u.id)
  OR EXISTS (SELECT 1 FROM push_devices d WHERE d.user_id = u.id))`;

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

/**
 * The address a subscription is kept and pushed to, or null when it may not be one: https, a push service's host in
 * plain letters, digits, hyphens and dots, and nothing else between `https://` and the path — no port, no name or
 * password, no percent-escapes. web-push reads the host again with Node's old url.parse, which ends it at a `%` or `;`
 * where the WHATWG parser (this check) decodes or keeps them: „%2e“ made a host this check read as Apple's one that
 * the request went to as the sender's choice (the server's own address among them). Written the plain way, both read
 * the same host.
 */
export function pushEndpoint(raw: string): string | null {
  if (raw.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const { hostname } = url;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname) || !PUSH_HOSTS.some((h) => h.test(hostname))) return null;
  if (!raw.startsWith(`https://${hostname}/`)) return null;
  return url.href;
}

export const SubscriptionSchema = z.object({
  endpoint: z.string().transform((raw, ctx) => {
    const endpoint = pushEndpoint(raw);
    if (endpoint === null) ctx.addIssue({ code: 'custom', message: 'Непозната услуга за известия.' });
    return endpoint ?? '';
  }),
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
/**
 * Keeps this device's subscription for the player. True when it's new to them: the app posts a device's subscription
 * again now and then (keepPushUp) to have it back should it have gone, and only a new one is greeted.
 */
export function subscribe(userId: number, sub: z.infer<typeof SubscriptionSchema>, session: string | null): boolean {
  const had = one('SELECT 1 AS x FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', sub.endpoint, userId);
  // `session`: the hash of the session it came with — when that session is gone, so is this (db.ts, v40's trigger).
  run(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at, session_token) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
       session_token = excluded.session_token`,
    sub.endpoint,
    userId,
    sub.keys.p256dh,
    sub.keys.auth,
    Date.now(),
    session,
  );
  run('UPDATE users SET push_prefs = COALESCE(push_prefs, ?) WHERE id = ?', JSON.stringify(defaultPushPrefs()), userId);
  return !had;
}

export const unsubscribe = (userId: number, endpoint: string) =>
  run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', userId, pushEndpoint(endpoint) ?? endpoint);

/**
 * What an app's device token may be: Apple's, hexadecimal; Google's, letters, digits and `-_:`. The server only ever
 * puts it in a request to that service (APNs: in the path), so nothing else gets in.
 */
export const DEVICE_TOKEN: Record<DevicePlatform, RegExp> = {
  ios: /^[0-9a-f]{64,200}$/i,
  android: /^[\w:-]{100,4096}$/,
};

/**
 * Keeps an app's device for the player, with the session it came with (the trigger drops it with that session).
 * True when it's new to them, as for a browser's (subscribe). `sandbox`: a token from Apple's sandbox (an iOS
 * app signed with a development provisioning profile).
 */
export function registerDevice(
  userId: number,
  device: { platform: DevicePlatform; token: string; sandbox: boolean },
  session: string | null,
): boolean {
  const had = one('SELECT 1 AS x FROM push_devices WHERE token = ? AND user_id = ?', device.token, userId);
  run(
    `INSERT INTO push_devices (token, platform, sandbox, user_id, session_token, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (token) DO UPDATE SET platform = excluded.platform, sandbox = excluded.sandbox,
       user_id = excluded.user_id, session_token = excluded.session_token`,
    device.token,
    device.platform,
    device.sandbox ? 1 : 0,
    userId,
    session,
    Date.now(),
  );
  run('UPDATE users SET push_prefs = COALESCE(push_prefs, ?) WHERE id = ?', JSON.stringify(defaultPushPrefs()), userId);
  return !had;
}

export const forgetDevice = (userId: number, token: string) =>
  run('DELETE FROM push_devices WHERE user_id = ? AND token = ?', userId, token);

export const setPushPrefs = (userId: number, prefs: PushPrefs) =>
  run('UPDATE users SET push_prefs = ? WHERE id = ?', JSON.stringify(prefs), userId);

export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap opens (a path in the app). */
  url: string;
  /** Pushes with the same tag replace each other on the device. */
  tag?: string;
  /**
   * The lines for an app's device, when these name someone: Apple's and Google's services read what they carry, so
   * there it says „приятел“ and the name waits in the app (a browser's push is encrypted end to end).
   */
  native?: { title: string; body: string };
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
  if (!anyPush()) return false;
  const subs = !config.vapid
    ? []
    : all<{ endpoint: string; p256dh: string; auth: string }>(
        'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
        userId,
      ).filter((s) => {
        if (pushEndpoint(s.endpoint) === s.endpoint) return true;
        // Kept before the check above was strict: never pushed to, and forgotten.
        run('DELETE FROM push_subscriptions WHERE endpoint = ?', s.endpoint);
        return false;
      });
  const devices = all<{ token: string; platform: DevicePlatform; sandbox: number }>(
    'SELECT token, platform, sandbox FROM push_devices WHERE user_id = ?',
    userId,
  ).filter((d) => nativePushFor(d.platform));
  if (!subs.length && !devices.length) return false;
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
  const { native, ...web } = message;
  const tag = message.tag ?? kind;
  const payload = JSON.stringify({ ...web, tag });
  const forApps: NativeMessage = { ...(native ?? { title: message.title, body: message.body }), url: message.url, tag };
  // Called within a match's result (or another write) it goes out once that's in: a result rolled back buzzes nobody,
  // and the day's count (push_sent) is rolled back with it.
  afterCommit(() => {
    if (config.pushOutbox) {
      fs.mkdirSync(config.pushOutbox, { recursive: true });
      const name = `${Date.now()}-${randomBytes(3).toString('hex')}.json`;
      fs.writeFileSync(
        path.join(config.pushOutbox, name),
        JSON.stringify({
          userId,
          kind,
          devices: subs.length + devices.length,
          ...JSON.parse(payload),
          ...(devices.length && { native: forApps, apps: devices.map((d) => d.platform) }),
        }),
      );
      return;
    }
    for (const s of subs)
      webpush
        .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 6 * 60 * 60,
          urgency: 'normal',
        })
        .catch((err: { statusCode?: number }) => pushFailed(s.endpoint, err));
    for (const d of devices)
      void (d.platform === 'ios' ? sendApns(d.token, d.sandbox === 1, forApps) : sendFcm(d.token, forApps)).then(
        (sent) => devicePushed(d.token, d.platform, sent),
      );
  });
  return true;
}

/** How an app's push went: a device that's gone is forgotten, any other failure reported. Never throws (pushFailed). */
const devicePushed = guarded('device push', (token: string, platform: DevicePlatform, sent: Sent) => {
  if (sent.ok) return;
  if (sent.gone) run('DELETE FROM push_devices WHERE token = ?', token);
  else
    void reportError(new Error(`${platform} push failed: ${sent.status} ${sent.reason}`.trim()), 'push', {
      extra: { platform, status: sent.status, reason: sent.reason },
    });
});

/**
 * A push that didn't go. A device that's gone (the browser dropped it, the app was removed) is forgotten; anything else
 * is reported. It runs in a promise's handler, where a throw (a busy or full database) would be nobody's to catch: it
 * never throws (the 31 October review, SERVER-7). Missed, the delete is made the next time that device is pushed.
 */
export const pushFailed = guarded('push failed', (endpoint: string, err: { statusCode?: number }) => {
  if (err.statusCode === 404 || err.statusCode === 410)
    run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
  else void reportError(err, 'push', { extra: { status: err.statusCode ?? null } });
});

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
  if (!anyPush()) return 0;
  const today = dayKey(now);
  const minute = minuteOfDay(now);
  const due = all<{ id: number; push_prefs: string }>(
    `SELECT u.id, u.push_prefs FROM users u
     WHERE u.push_prefs IS NOT NULL AND ${HAS_DEVICE}
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
    `SELECT u.* FROM users u WHERE u.push_prefs IS NOT NULL AND ${HAS_DEVICE}
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
  if (!anyPush() || quietNow(now)) return 0;
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
