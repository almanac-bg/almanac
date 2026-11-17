// When a guest is asked to keep their game: from the second day played (a habit begun is worth keeping), or at once
// in an app's own browser (lib/embedded.ts), which keeps a game from the phone's browser. Pure, so that it's tested on
// its own.

/** Whether to ask a player to keep their game: a guest (no email) who has played two days (`days`, as far as it
 * counts: 1 or 2), or is in an app's own browser (`embedded`). */
export function askToKeep(p: { email?: string; days: number; embedded: boolean }): boolean {
  if (p.email) return false;
  return p.days >= 2 || p.embedded;
}
