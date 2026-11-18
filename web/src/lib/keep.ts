// When a guest is asked to keep their game: from the second day played (a habit begun is worth keeping), or at once
// in an app's own browser (lib/embedded.ts), which keeps a game from the phone's browser. And what's said once the
// code is in: that the game is kept, or whose profile it joined. Pure, so that it's tested on its own.

/** Whether to ask a player to keep their game: a guest (no email) who has played two days (`days`, as far as it
 * counts: 1 or 2), or is in an app's own browser (`embedded`). */
export function askToKeep(p: { email?: string; days: number; embedded: boolean }): boolean {
  if (p.email) return false;
  return p.days >= 2 || p.embedded;
}

/** Who a player is, as far as these words go. */
interface Who {
  id: number;
  name: string;
  email?: string;
}

/** What came of a code put in (account.Verify), said where it was (`before`: the player until then, if anyone; `after`
 * as the server sends them back): a guest's game kept with the email, or the profile signed in to, which a guest's
 * game here joins. */
export function keptWords(before: Who | null | undefined, after: Who): string {
  if (before && !before.email && before.id === after.id)
    return `Готово. Играта ти е запазена с имейла ${after.email}. Влизай с него от всяко устройство.`;
  if (before && !before.email) return `Влезе като ${after.name}. Играта оттук е добавена към профила ти.`;
  return `Влезе като ${after.name}.`;
}
