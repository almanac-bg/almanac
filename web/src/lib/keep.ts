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
    return `Готово. Играта ти е запазена с имейла ${after.email}. Влизай с него на всяко устройство.`;
  if (before && !before.email) return `Влезе като ${after.name}. Играта оттук е добавена към профила ти.`;
  return `Влезе като ${after.name}.`;
}

/** What a device keeps of the day's reminder's asks under the day's result (screens/today.ts, remindAsk): asked by
 * notification or, where none can come, by mail (which asks a guest for the email that keeps the game too). */
export interface RemindAsks {
  /** How many were said no to: three end the asking (a yes counts as three). */
  n: number;
  /** The day of the last answer: never asked twice in a day. */
  day: string;
  /** The day the ask by mail was told „Не сега“: it was the ask for the email, so the line to keep the game with one
   * (screens/keep.ts, keepLine) keeps quiet that day too. */
  mailNo?: string;
}

/** The asks as kept (`text`; anything unreadable: none yet). */
export function remindAsks(text: string | null): RemindAsks {
  let kept: Partial<RemindAsks> = {};
  try {
    kept = JSON.parse(text ?? "{}") ?? {};
  } catch {
    // none, then
  }
  return {
    n: typeof kept.n === "number" ? kept.n : 0,
    day: typeof kept.day === "string" ? kept.day : "",
    mailNo: typeof kept.mailNo === "string" ? kept.mailNo : undefined,
  };
}

/** The asks once `by`'s is answered on `day`: a yes ends them; a no counts, and by mail it covers the ask to keep the
 * game that day. */
export function remindAnswered(a: RemindAsks, by: "push" | "mail", day: string, yes: boolean): RemindAsks {
  return { ...a, n: yes ? 3 : a.n + 1, day, mailNo: !yes && by === "mail" ? day : a.mailNo };
}
