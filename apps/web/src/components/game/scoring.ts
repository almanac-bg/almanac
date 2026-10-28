import { SCORING } from '@quiz/shared';

/** How points are counted, in one line: speed is half of every answer's worth, and nothing in the game said so. */
export const SCORING_LINE = `${SCORING.base} точки за верен отговор, до +${SCORING.speed} за бързина (след време за четене) и +${SCORING.streakStep} за всеки пореден верен (до +${SCORING.streakMax}).`;

const SHOWN_KEY = 'quiz:scoring-shown';
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
