import { isSoloPace, type SoloPace } from '@quiz/shared';

/** Соло's clock, as the player last chose it on this device (a convenience: lost storage means the usual 15 s). */
const KEY = 'quiz_solo_pace';

export function savedSoloPace(): SoloPace {
  try {
    const value = localStorage.getItem(KEY);
    return isSoloPace(value) ? value : 'normal';
  } catch {
    return 'normal';
  }
}

export function saveSoloPace(pace: SoloPace) {
  try {
    localStorage.setItem(KEY, pace);
  } catch {
    // Private mode or blocked storage: it's chosen for this match all the same.
  }
}
