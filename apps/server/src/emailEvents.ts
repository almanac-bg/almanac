import { timingSafeEqual } from 'node:crypto';
import { config } from './config';
import { run } from './db';
import { count } from './stats';
import { getUserByEmail } from './users';

/**
 * What Scaleway reports about the mail we sent: a hard bounce, a mailbox that doesn't exist, a spam complaint, an
 * address on their blocklist. Such an address gets no more reminders (repeated mail to dead or unwilling addresses is
 * what costs a sender its reputation), and Settings tells the player to check it.
 *
 * The reports arrive through Scaleway Topics and Events, SNS-style: a JSON body with `Type`, and the event in
 * `Message`. The endpoint's address carries a secret (EMAIL_EVENTS_SECRET), so nobody else can post to it; at worst a
 * forged event would switch someone's reminders off.
 */
const UNDELIVERABLE = new Set(['email_dropped', 'email_mailbox_not_found', 'email_spam', 'email_blocklisted']);

/** Whether a request's secret is this installation's (in constant time). No secret configured: nothing matches. */
export function emailEventsSecretMatches(secret: string): boolean {
  const expected = config.emailEventsSecret;
  if (!expected) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The subscription is confirmed by visiting the link in it: only one on Scaleway's own servers. */
function scalewayUrl(raw: unknown): string | null {
  const url = typeof raw === 'string' ? URL.parse(raw) : null;
  if (!url || url.protocol !== 'https:') return null;
  return url.hostname.endsWith('.scaleway.com') || url.hostname.endsWith('.scw.cloud') ? url.href : null;
}

export async function handleEmailEvent(body: unknown): Promise<'confirmed' | 'handled' | 'ignored'> {
  const message = typeof body === 'string' ? safeJson(body) : body;
  if (!message || typeof message !== 'object') return 'ignored';
  const { Type: type, SubscribeURL: subscribeUrl, Message: payload } = message as Record<string, unknown>;

  if (type === 'SubscriptionConfirmation') {
    const url = scalewayUrl(subscribeUrl);
    if (!url) return 'ignored';
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    console.log(`📮 Email events: subscription ${res.ok ? 'confirmed' : `not confirmed (${res.status})`}`);
    return res.ok ? 'confirmed' : 'ignored';
  }
  if (type !== 'Notification' || typeof payload !== 'string') return 'ignored';

  const event = safeJson(payload) as { type?: unknown; email_to?: unknown } | null;
  const kind = typeof event?.type === 'string' ? event.type : null;
  const to = typeof event?.email_to === 'string' ? event.email_to : null;
  if (!kind || !to || !UNDELIVERABLE.has(kind)) return 'ignored';
  count(`email_events:${kind}`);
  const user = getUserByEmail(to);
  if (!user) return 'handled';
  run('UPDATE users SET streak_reminders = 0, email_bounced_at = ? WHERE id = ?', Date.now(), user.id);
  return 'handled';
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
