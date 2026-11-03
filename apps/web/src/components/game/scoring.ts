export { SCORING_LINE } from '@almanac/client';

const SHOWN_KEY = 'almanac:scoring-shown';
/** How many matches open with the line, before the player has the hang of it. */
const FIRST_MATCHES = 3;

/** Whether this match's countdown should spell out the scoring: a player's first few matches on this device. */
export function takeScoringHint(): boolean {
  try {
    const shown = Number(window.localStorage.getItem(SHOWN_KEY) ?? 0);
    if (shown >= FIRST_MATCHES) return false;
    window.localStorage.setItem(SHOWN_KEY, String(shown + 1));
    return true;
  } catch {
    return false;
  }
}
