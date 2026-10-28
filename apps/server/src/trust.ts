import { dayKey, RATED_AFTER } from '@quiz/shared';
import type { UserRow } from './users';

// What a second account may not do on its first day. One costs about ten seconds (a guest, then saving it), so wherever
// a result is compared with other people's, a brand-new account is kept apart: it could have been made only to read the
// answers off, or to lose on purpose.

/**
 * On the day's board: an account made before `day` began. A guest, or an account made today, plays the same questions
 * but off the board, seeing where it would have placed. One set for everyone is what lets friends compare their day;
 * the price, accepted, is that a throwaway can see the answers before the account that plays next. The throwaway itself
 * never lands on the board, and play no person could manage shows in the answer log (answers.ts).
 */
export function onDailyBoard(user: Pick<UserRow, 'is_guest' | 'created_at'>, day = dayKey()): boolean {
  return user.is_guest === 0 && dayKey(user.created_at) < day;
}

/**
 * Moves other people's rating (and has its own moved by them): an account at least a day old with RATED_AFTER.games
 * matches played. Against bots every account is rated from the first match.
 */
export function ratesPeople(user: Pick<UserRow, 'is_guest' | 'created_at' | 'games_played'>, now = Date.now()) {
  return user.is_guest === 0 && now - user.created_at >= RATED_AFTER.ms && user.games_played >= RATED_AFTER.games;
}
