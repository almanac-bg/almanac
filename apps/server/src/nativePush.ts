import { createPrivateKey, sign } from 'node:crypto';
import http2 from 'node:http2';
import { config } from './config';

/**
 * The apps' pushes, sent straight to the phone makers' services: Apple's (APNs) for the iOS app, Google's (Firebase
 * Cloud Messaging, HTTP v1) for the Android one — no service of anyone else's in between (the 31 October review,
 * MOBILE-7; decision D13). Unlike a browser's push, the service can read what it carries, so what's sent here names
 * nobody (push.ts → PushMessage.native).
 */

/** What goes to a phone: the lines it shows, where a tap opens, and the kind (one of a kind replaces the last). */
export interface NativeMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** How a push went: out, the device gone (its token no longer valid: forget it), or failed (reported). */
export type Sent = { ok: true } | { ok: false; gone: boolean; status: number; reason: string };

/** Pushes keep for six hours, as the web's (TTL): a turn in a friend duel is still worth knowing about by then. */
const KEEP_S = 6 * 60 * 60;

const base64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

/** A signed JWT: ES256 for Apple (the raw r‖s signature JOSE wants), RS256 for Google. */
function jwt(alg: 'ES256' | 'RS256', header: Record<string, string>, claims: Record<string, unknown>, key: string) {
  const data = `${base64url(JSON.stringify({ alg, typ: 'JWT', ...header }))}.${base64url(JSON.stringify(claims))}`;
  const signature = sign('sha256', Buffer.from(data), {
    key: createPrivateKey(key),
    ...(alg === 'ES256' && { dsaEncoding: 'ieee-p1363' as const }),
  });
  return `${data}.${base64url(signature)}`;
}

// ─── Apple ───────────────────────────────────────────────────────────────────

/** Apple wants the token key's JWT renewed at least hourly, and not more often than every 20 minutes. */
const APNS_TOKEN_MS = 40 * 60_000;
let apnsToken: { value: string; at: number } | null = null;
function apnsAuth(now = Date.now()): string {
  const apns = config.apns!;
  if (!apnsToken || now - apnsToken.at > APNS_TOKEN_MS)
    apnsToken = {
      value: jwt('ES256', { kid: apns.keyId }, { iss: apns.teamId, iat: Math.floor(now / 1000) }, apns.key),
      at: now,
    };
  return apnsToken.value;
}

/** One HTTP/2 connection per Apple host, kept while it lasts (Apple asks for that, not one per push). */
const sessions = new Map<string, http2.ClientHttp2Session>();
function apnsSession(origin: string): http2.ClientHttp2Session {
  const open = sessions.get(origin);
  if (open && !open.closed && !open.destroyed) return open;
  const session = http2.connect(origin);
  const forget = () => {
    if (sessions.get(origin) === session) sessions.delete(origin);
  };
  session.on('close', forget);
  session.on('goaway', forget);
  session.on('error', forget);
  // Not what keeps the process up: a restart doesn't wait for an idle connection to Apple.
  session.unref();
  sessions.set(origin, session);
  return session;
}

/** An iOS device's push: `sandbox` for an app built for development, which Apple's other host serves. */
export function sendApns(token: string, sandbox: boolean, message: NativeMessage): Promise<Sent> {
  const apns = config.apns!;
  const origin = apns.url ?? (sandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');
  const body = JSON.stringify({
    aps: { alert: { title: message.title, body: message.body }, sound: 'default', 'thread-id': message.tag },
    url: message.url,
  });
  return new Promise((resolve) => {
    let request: http2.ClientHttp2Stream;
    try {
      request = apnsSession(origin).request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${apnsAuth()}`,
        'apns-topic': apns.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + KEEP_S),
        'apns-collapse-id': message.tag,
        'content-type': 'application/json',
      });
    } catch (err) {
      resolve({ ok: false, gone: false, status: 0, reason: (err as Error).message });
      return;
    }
    let status = 0;
    let answer = '';
    request.setEncoding('utf8');
    request.on('response', (headers) => {
      status = Number(headers[':status']);
    });
    request.on('data', (chunk: string) => {
      answer += chunk;
    });
    request.on('end', () => {
      if (status === 200) return resolve({ ok: true });
      const reason = (() => {
        try {
          return String((JSON.parse(answer) as { reason?: unknown }).reason ?? '');
        } catch {
          return '';
        }
      })();
      // The app was removed, or the token is no longer this app's: forget the device.
      const gone = status === 410 || reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic';
      // Apple refused the key's JWT: a new one next time.
      if (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken') apnsToken = null;
      resolve({ ok: false, gone, status, reason });
    });
    request.on('error', (err) => resolve({ ok: false, gone: false, status, reason: err.message }));
    // Cut off without an answer (the timeout below, the connection gone): failed. After `end`, this changes nothing.
    request.on('close', () => resolve({ ok: false, gone: false, status, reason: 'closed without an answer' }));
    request.setTimeout(15_000, () => request.close(http2.constants.NGHTTP2_CANCEL));
    request.end(body);
  });
}

// ─── Google ──────────────────────────────────────────────────────────────────

/** The service account's access token (an hour long), asked for anew a minute before it ends. */
let fcmAccess: { value: string; until: number } | null = null;
async function fcmAuth(now = Date.now()): Promise<string> {
  if (fcmAccess && now < fcmAccess.until - 60_000) return fcmAccess.value;
  const fcm = config.fcm!;
  const iat = Math.floor(now / 1000);
  const assertion = jwt(
    'RS256',
    {},
    {
      iss: fcm.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: fcm.tokenUri,
      iat,
      exp: iat + 3600,
    },
    fcm.privateKey,
  );
  const res = await fetch(fcm.tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(15_000),
  });
  const answer = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !answer.access_token) throw new Error(`FCM sign-in failed (${res.status})`);
  fcmAccess = { value: answer.access_token, until: now + (answer.expires_in ?? 3600) * 1000 };
  return fcmAccess.value;
}

/** An Android device's push. */
export async function sendFcm(token: string, message: NativeMessage): Promise<Sent> {
  const fcm = config.fcm!;
  let res: Response;
  try {
    res = await fetch(`${fcm.url}/v1/projects/${encodeURIComponent(fcm.projectId)}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await fcmAuth()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: message.title, body: message.body },
          data: { url: message.url, tag: message.tag },
          android: {
            ttl: `${KEEP_S}s`,
            collapse_key: message.tag,
            notification: { tag: message.tag, sound: 'default' },
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, gone: false, status: 0, reason: (err as Error).message };
  }
  if (res.ok) return { ok: true };
  const answer = (await res.json().catch(() => ({}))) as {
    error?: { status?: string; details?: { errorCode?: string }[] };
  };
  const codes = [answer.error?.status, ...(answer.error?.details ?? []).map((d) => d.errorCode)];
  if (res.status === 401) fcmAccess = null;
  // The app was removed, or the token was never one: forget the device.
  const gone = codes.includes('UNREGISTERED') || res.status === 404;
  return { ok: false, gone, status: res.status, reason: codes.filter(Boolean).join(' ') };
}
