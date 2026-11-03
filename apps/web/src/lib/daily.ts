import { api } from '@almanac/client';

export { offBoardLine, offBoardWhy, placeShown } from '@almanac/client';

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
