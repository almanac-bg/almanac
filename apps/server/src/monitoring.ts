import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { format } from 'node:util';
import { scrubPaths } from '@quiz/shared';
import { config } from './config';
import { throttled } from './throttle';

/**
 * Error reports to Sentry (its EU region), so a crash reaches the owner's inbox instead of only the server log.
 * Off unless SENTRY_DSN is set. No SDK: server errors are posted as plain Sentry envelopes, and the browser SDK's
 * reports come through /api/monitoring (see forwardEnvelope), so players' browsers never talk to a third party and
 * their IP addresses aren't passed on.
 */

interface Dsn {
  raw: string;
  key: string;
  /** Where envelopes go: https://<host>/api/<project>/envelope/ */
  url: string;
}

function parseDsn(raw: string | null): Dsn | null {
  if (!raw) return null;
  const url = URL.parse(raw);
  const project = url?.pathname.replace(/^\/+|\/+$/g, '');
  if (!url?.username || !project) {
    console.warn('📡 SENTRY_DSN is not a valid DSN; error reports are off.');
    return null;
  }
  return { raw, key: url.username, url: `${url.protocol}//${url.host}/api/${project}/envelope/` };
}

const dsn = parseDsn(config.sentryDsn);
/** The public DSN for the browser SDK (DSNs are meant to be public; they only allow sending events). */
export const publicDsn = dsn?.raw ?? null;

// The free plan allows 5,000 errors a month: a burst (or one bug firing in a loop) mustn't use it up.
const MAX_PER_MINUTE = 20;
const REPEAT_AFTER_MS = 10 * 60_000;
let windowStart = 0;
let sentInWindow = 0;
const lastSent = new Map<string, number>();

function allowed(fingerprint: string, now: number): boolean {
  if (now - windowStart > 60_000) {
    windowStart = now;
    sentInWindow = 0;
  }
  if (sentInWindow >= MAX_PER_MINUTE) return false;
  const last = lastSent.get(fingerprint);
  if (last !== undefined && now - last < REPEAT_AFTER_MS) return false;
  if (lastSent.size > 1000) lastSent.clear();
  lastSent.set(fingerprint, now);
  sentInWindow++;
  return true;
}

interface Frame {
  function?: string;
  filename: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

/** V8 stack lines ("at fn (file:line:col)") as Sentry frames, oldest call first. */
function frames(stack: string | undefined): Frame[] {
  const out: Frame[] = [];
  for (const line of (stack ?? '').split('\n')) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    const filename = m[2].replace(/^file:\/\//, '');
    out.push({
      function: m[1],
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !filename.includes('node_modules') && !filename.startsWith('node:'),
    });
  }
  return out.reverse();
}

async function send(envelopeUrl: string, body: string) {
  try {
    await fetch(envelopeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope' },
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Monitoring must never be the thing that fails: a lost report is fine.
  }
}

/**
 * Logs a server error and, with monitoring on, reports it. `where` names the part of the game it came from
 * (it groups and tags the report); `userId` is only the account number, never a name or email.
 */
export function reportError(
  err: unknown,
  where: string,
  details: { userId?: number; extra?: Record<string, unknown> } = {},
) {
  // `where` can hold a request path: an argument, never part of the format string (a "%s" in it would garble the log).
  console.error('💥 %s:', where, err);
  if (!dsn) return Promise.resolve();
  const error = err instanceof Error ? err : new Error(String(err));
  const now = Date.now();
  if (!allowed(`${where}|${error.name}|${error.message}`, now)) return Promise.resolve();
  const eventId = randomUUID().replaceAll('-', '');
  const event = {
    event_id: eventId,
    timestamp: now / 1000,
    platform: 'node',
    level: 'error',
    server_name: os.hostname(),
    environment: config.production ? 'production' : 'development',
    release: config.release ?? undefined,
    tags: { where },
    user: details.userId ? { id: String(details.userId) } : undefined,
    extra: details.extra,
    exception: { values: [{ type: error.name, value: error.message, stacktrace: { frames: frames(error.stack) } }] },
  };
  const header = { event_id: eventId, sent_at: new Date(now).toISOString(), dsn: dsn.raw };
  return send(dsn.url, `${JSON.stringify(header)}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`);
}

/**
 * Watches how long the event loop is held up. Every match's timers, every socket and every database query run on it,
 * so anything synchronous that runs long freezes every live match at once. Each period, the worst hold-up goes to the
 * log when it's worth a look, and into an error report when matches visibly froze (always the same report, so they
 * group, and repeats within ten minutes are held back). Returns a stop.
 */
export function watchEventLoop({ everyMs = 60_000, logMs = 200, reportMs = 1000 } = {}): () => void {
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  let memoryReportedAt = 0;
  const timer = setInterval(() => {
    // Docker stops the app at 1 GB (docker-compose.yml): a leak shows here long before it's killed for it.
    const { rss, heapUsed } = process.memoryUsage();
    if (rss > MEMORY_LOG_BYTES) {
      const mb = (n: number) => Math.round(n / 2 ** 20);
      console.warn(`🧠 Memory: ${mb(rss)} MB in use (${mb(heapUsed)} MB of it JavaScript objects).`);
      if (rss > MEMORY_REPORT_BYTES && Date.now() - memoryReportedAt > 60 * 60_000) {
        memoryReportedAt = Date.now();
        void reportError(new Error('Memory use is close to the limit'), 'memory', { extra: { rssMb: mb(rss) } });
      }
    }
    const worstMs = Math.round(delay.max / 1e6);
    const p99Ms = Math.round(delay.percentile(99) / 1e6);
    delay.reset();
    if (worstMs >= reportMs) {
      void reportError(new Error('The event loop stalled'), 'event loop', { extra: { worstMs, p99Ms } });
    } else if (worstMs >= logMs) {
      console.warn(
        `🐢 The event loop was held up for ${worstMs} ms (p99 ${p99Ms} ms) in the last ${everyMs / 1000} s.`,
      );
    }
  }, everyMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    delay.disable();
  };
}

/** Above this the server logs its memory use every minute; above the second, it reports it (hourly at most). */
const MEMORY_LOG_BYTES = 600 * 2 ** 20;
const MEMORY_REPORT_BYTES = 800 * 2 ** 20;

/**
 * Browser reports use the same monthly quota, and the DSN is public: anyone can post envelopes, from any number of
 * addresses. Past these, they're dropped (the browser SDK already skips repeats on its side).
 */
const BROWSER_PER_MINUTE = 10;
const BROWSER_PER_DAY = 150;

/**
 * The browser SDK's tunnel: passes an envelope on to Sentry if it's addressed to this site's own project (so the
 * endpoint can't be used to send anything anywhere else). Returns false when it isn't. Over the cap it's accepted and
 * dropped, so the SDK doesn't retry.
 */
export function forwardEnvelope(body: string): boolean {
  if (!dsn) return false;
  const newline = body.indexOf('\n');
  let header: { dsn?: unknown } = {};
  try {
    header = JSON.parse(newline === -1 ? body : body.slice(0, newline));
  } catch {
    return false;
  }
  if (header.dsn !== dsn.raw) return false;
  if (throttled('monitoring-browser', BROWSER_PER_MINUTE, 60_000)) return true;
  if (throttled('monitoring-browser-day', BROWSER_PER_DAY, 24 * 60 * 60_000)) return true;
  void send(dsn.url, body);
  return true;
}

/**
 * The server's log, kept off the server too: every line it writes also goes to Sentry's logs (the same EU project,
 * kept 30 days), so it can be searched by day and survives the server. What could name a person stays behind: email
 * and IP addresses, and the names and codes in addresses (scrubPaths). A flood (a bug logging in a loop) is capped,
 * so it can't use up the monthly quota. Returns a stop that flushes what's waiting.
 */
export function shipLogs(): () => Promise<void> {
  if (!dsn) return async () => {};
  const target = dsn;
  // One id per run of the server: its lines read together in Sentry, a restart starts a new one.
  const run = randomUUID().replaceAll('-', '');
  const attribute = (value: string) => ({ value, type: 'string' as const });
  const base: LogItem['attributes'] = {
    'sentry.environment': attribute(config.production ? 'production' : 'development'),
    'sentry.sdk.name': attribute('almanac.server'),
    'server.address': attribute(os.hostname()),
    ...(config.release ? { 'sentry.release': attribute(config.release) } : {}),
  };
  const queue: LogItem[] = [];
  let held = 0;
  const add = (level: LogLevel, text: string) => {
    if (throttled('log-lines', LOGS_PER_MINUTE, 60_000) || queue.length >= LOG_QUEUE) {
      held++;
      return;
    }
    queue.push(item(level, text));
    if (queue.length >= LOG_BATCH) setImmediate(flush);
  };
  const item = (level: LogLevel, text: string): LogItem => ({
    timestamp: Date.now() / 1000,
    trace_id: run,
    level,
    severity_number: SEVERITY[level],
    body: scrubLog(text).slice(0, LOG_CHARS),
    attributes: base,
  });
  const flush = (): Promise<void> => {
    if (held) {
      queue.push(item('warn', `📡 ${held} log line(s) held back: more than ${LOGS_PER_MINUTE} a minute.`));
      held = 0;
    }
    if (!queue.length) return Promise.resolve();
    const items = queue.splice(0, LOG_BATCH);
    const sent = send(
      target.url,
      `${JSON.stringify({ sent_at: new Date().toISOString(), dsn: target.raw })}\n${JSON.stringify({
        type: 'log',
        item_count: items.length,
        content_type: 'application/vnd.sentry.items.log+json',
      })}\n${JSON.stringify({ items })}\n`,
    );
    return queue.length ? Promise.all([sent, flush()]).then(() => {}) : sent;
  };

  // Each console call still writes to stdout (`docker compose logs`) exactly as before, and is queued on its way.
  const methods = { log: 'info', info: 'info', warn: 'warn', error: 'error' } as const;
  const originals = new Map<keyof typeof methods, (...args: unknown[]) => void>();
  for (const [method, level] of Object.entries(methods) as [keyof typeof methods, LogLevel][]) {
    const original = console[method];
    originals.set(method, original);
    console[method] = (...args: unknown[]) => {
      original.apply(console, args);
      add(level, format(...args));
    };
  }
  const timer = setInterval(flush, LOG_FLUSH_MS);
  timer.unref();
  flushLogs = flush;
  return () => {
    clearInterval(timer);
    for (const [method, original] of originals) console[method] = original;
    flushLogs = async () => {};
    return flush();
  };
}

/** Sends the log lines waiting to go (before the process exits on a crash); nothing when logs aren't shipped. */
export let flushLogs: () => Promise<void> = async () => {};

type LogLevel = 'info' | 'warn' | 'error';
interface LogItem {
  timestamp: number;
  trace_id: string;
  level: LogLevel;
  severity_number: number;
  body: string;
  attributes: Record<string, { value: string; type: 'string' }>;
}
const SEVERITY: Record<LogLevel, number> = { info: 9, warn: 13, error: 17 };
/** Lines a minute: the server writes a few dozen an hour, a flood is a bug (5 GB a month are free). */
const LOGS_PER_MINUTE = 300;
const LOG_QUEUE = 1000;
const LOG_BATCH = 100;
const LOG_FLUSH_MS = 5000;
const LOG_CHARS = 8000;

/** A log line as it leaves the server: no email or IP addresses, no names or codes in addresses. */
export function scrubLog(text: string): string {
  return scrubPaths(text)
    .replace(/[^\s@<>"'`()[\]]+@[^\s@<>"'`()[\]]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .replace(
      /\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){7}\b|\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*::(?:[0-9a-f]{1,4}\b(?::[0-9a-f]{1,4}\b)*)?/gi,
      '[ip]',
    );
}
