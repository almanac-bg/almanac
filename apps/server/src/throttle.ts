/** Tiny in-memory rate limiting: N events per key per window (IPs, accounts, rooms…). */
const windows = new Map<string, { count: number; resetAt: number }>();

/** Keys rarely outlive their window, but a flood of random keys mustn't grow memory without bound. */
const MAX_KEYS = 100_000;

function sweep(now: number) {
  for (const [key, entry] of windows) if (entry.resetAt < now) windows.delete(key);
}
setInterval(() => sweep(Date.now()), 10 * 60_000).unref();

/** Counts one event for `key`; true once it went over `limit` within `windowMs`. */
export function throttled(key: string, limit = 10, windowMs = 5 * 60_000): boolean {
  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || entry.resetAt < now) {
    if (windows.size >= MAX_KEYS) {
      sweep(now);
      // Still full of live windows: under attack. Forgetting them all is better than running out of memory.
      if (windows.size >= MAX_KEYS) windows.clear();
    }
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count++;
  return entry.count > limit;
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
