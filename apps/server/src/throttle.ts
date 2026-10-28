import { isIPv6 } from 'node:net';

interface Window {
  count: number;
  limit: number;
  resetAt: number;
}

/** When a scope is full: how many of its oldest keys are looked at for one that can be forgotten. */
const EVICTION_TRIES = 8;

/**
 * Tiny in-memory rate limiting: N events per key per window (IPs, accounts, rooms…).
 *
 * Keys are `scope:detail` (`login-ip:203.0.113.7`), and each scope holds at most `capacity` keys of its own. A flood of
 * new keys (random usernames, the 65,536 networks of one IPv6 /48) can only crowd its own scope, never another's
 * counters; a counter for everyone has no detail (`guest-all`), so it's a scope by itself. In a full scope the oldest
 * key goes first — except a limit that has been hit, which holds for its whole window: while the oldest keys are all
 * such limits, a new key is turned away (counted as over its limit) rather than one of them forgotten.
 */
export class RateLimiter {
  private scopes = new Map<string, Map<string, Window>>();

  constructor(private capacity: number) {}

  /** Counts one event for `key`; true once it went over `limit` within `windowMs`. */
  hit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const colon = key.indexOf(':');
    const name = colon === -1 ? key : key.slice(0, colon);
    let scope = this.scopes.get(name);
    if (!scope) {
      scope = new Map();
      this.scopes.set(name, scope);
    }
    const entry = scope.get(key);
    if (entry && entry.resetAt >= now) {
      entry.count++;
      return entry.count > limit;
    }
    // A window that ended starts again as the newest key (a Map keeps keys in the order they were added).
    if (entry) scope.delete(key);
    else if (scope.size >= this.capacity && !this.makeRoom(scope, now)) return true;
    scope.set(key, { count: 1, limit, resetAt: now + windowMs });
    return false;
  }

  /** How many keys a scope holds right now. */
  keys(scope: string): number {
    return this.scopes.get(scope)?.size ?? 0;
  }

  /** Forgets windows that have ended (each would start again on its next event anyway). */
  sweep(now = Date.now()) {
    for (const scope of this.scopes.values()) for (const [key, w] of scope) if (w.resetAt < now) scope.delete(key);
  }

  /** Forgets the oldest key that isn't holding anyone back; one that is goes to the back. False if none was found. */
  private makeRoom(scope: Map<string, Window>, now: number): boolean {
    for (let i = 0; i < EVICTION_TRIES; i++) {
      const [key, w] = scope.entries().next().value!;
      scope.delete(key);
      if (w.resetAt < now || w.count <= w.limit) return true;
      scope.set(key, w);
    }
    return false;
  }
}

/** Per scope: far more than are ever in use at once, and a few MB when a scope is flooded. */
const limiter = new RateLimiter(10_000);
setInterval(() => limiter.sweep(), 10 * 60_000).unref();

/** Counts one event for `key` (`scope:detail`, see RateLimiter); true once it went over `limit` within `windowMs`. */
export function throttled(key: string, limit = 10, windowMs = 5 * 60_000): boolean {
  return limiter.hit(key, limit, windowMs);
}

/**
 * The network an address belongs to, as a rate-limit key: an IPv4 address as is, an IPv6 address by its /64 — one phone
 * or home gets a whole /64 and can pick a new address from it at will.
 */
export function network(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!isIPv6(ip)) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('%')[0].split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/**
 * The wider network around an address: an IPv4 /24, an IPv6 /48 (what one site or provider customer usually holds).
 * A flood spread over many addresses of one network still shares this.
 */
export function wideNetwork(ip: string | undefined): string {
  const net = network(ip);
  const v4 = /^(\d+\.\d+\.\d+)\.\d+$/.exec(net);
  if (v4) return `${v4[1]}.0/24`;
  if (!net.endsWith('::/64')) return net;
  return `${net.slice(0, -'::/64'.length).split(':').slice(0, 3).join(':')}::/48`;
}

/**
 * Token bucket for socket events: short bursts are fine (answer + joker + emote), a stream isn't.
 * Returns a function that says whether the next event is allowed.
 */
export function eventBucket(capacity = 30, perSecond = 10): () => boolean {
  let tokens = capacity;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * perSecond);
    last = now;
    if (tokens < 1) return false;
    tokens--;
    return true;
  };
}
