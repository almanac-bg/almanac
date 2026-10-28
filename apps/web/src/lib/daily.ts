/**
 * Why today's daily is on questions of its own (DailyInfo.ownSet), for a guest or an account made today: a second
 * account costs seconds, so one made today could be there only to read the answers off for another.
 */
export function ownDailyLine(guest: boolean) {
  return guest
    ? 'Като гост играеш свои 10 въпроса, без класация. Запази профила си, за да играеш общите с всички.'
    : 'Нов профил играе свои 10 въпроса в първия си ден. От утре — общите и класацията.';
}
