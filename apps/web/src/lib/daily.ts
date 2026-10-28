import { api, ordinal } from '@quiz/client';

/**
 * Where a run off the day's board would stand on it, and when the player joins the board (DailyInfo.offBoard): a guest
 * once the profile is saved (made before today: that day; made today: the next), a new account from tomorrow. A second
 * account costs seconds, so one made today could be there only to read the answers off for another.
 */
export function offBoardLine(d: { guest: boolean; madeToday: boolean; rank: number; total: number }) {
  return `Щеше да си на ${ordinal(d.rank)} място от ${d.total + 1}. ${offBoardWhy(d)}`;
}

/** offBoardLine without the place: when the place is shown on its own. */
export function offBoardWhy(d: { guest: boolean; madeToday: boolean }) {
  if (!d.guest) return 'Новият ти профил влиза в класацията от утре.';
  return d.madeToday ? 'Запази профила — от утре влизаш в класацията.' : 'Запази профила и влизаш в класацията.';
}

/**
 * The player's link to today's questions: the same ten for whoever opens it, and the player hears how they did. Asked
 * for once the day is played; without it (offline), the day's page itself.
 */
export async function dailyLinkUrl(): Promise<string> {
  try {
    return `${window.location.origin}/daily/${(await api.dailyLink()).code}`;
  } catch {
    return `${window.location.origin}/daily`;
  }
}
