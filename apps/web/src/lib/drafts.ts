/**
 * Unsaved typed work, kept in this tab (sessionStorage) as it's typed: a reload, a crash, a deploy or a match popping
 * up doesn't take it. `base` is what it was written against (the saved set, say): a draft over something that has
 * changed since is no longer this one's, and is dropped.
 */
const PREFIX = 'quiz:draft:';

export function loadDraft<T>(key: string, base: string): T | null {
  try {
    const kept = sessionStorage.getItem(PREFIX + key);
    if (!kept) return null;
    const { base: was, value } = JSON.parse(kept) as { base: string; value: T };
    if (was === base) return value;
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable, or not ours */
  }
  return null;
}

/** Keeps `value` (null: there's nothing unsaved, so nothing to keep). */
export function keepDraft(key: string, base: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(PREFIX + key);
    else sessionStorage.setItem(PREFIX + key, JSON.stringify({ base, value }));
  } catch {
    /* storage unavailable or full: the page still works, only without the copy */
  }
}
