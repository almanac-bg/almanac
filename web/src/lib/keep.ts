// When a guest is asked to keep their profile with an email: once they keep coming back (three days in a row, or
// level 3), and not again for a week after „По-късно“. Pure, so that it's tested on its own.

/** How long „По-късно“ puts the ask off. */
export const keepLater = 7 * 24 * 60 * 60 * 1000;

/** Whether to ask a player to keep their profile: a guest (no email) who keeps coming back, not put off lately. */
export function askToKeep(p: { email?: string; streak: number; level: number; laterAt: number; now: number }): boolean {
  if (p.email) return false;
  if (p.streak < 3 && p.level < 3) return false;
  return p.now - p.laterAt >= keepLater;
}
