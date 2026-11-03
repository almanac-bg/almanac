import { toast } from '@almanac/client';
import { dayKey } from '@almanac/shared';

export { dailyShareText, matchShareText } from '@almanac/client';

const storageKey = (day: string) => `almanac:daily-share:${day}`;

/** Remembered for the rest of the day, so the lobby can offer to share it again. */
export function rememberDailyShare(text: string, day = dayKey()) {
  try {
    localStorage.setItem(storageKey(day), text);
  } catch {
    /* storage unavailable */
  }
}

export function savedDailyShare(day = dayKey()): string | null {
  try {
    return localStorage.getItem(storageKey(day));
  } catch {
    return null;
  }
}

/**
 * Phones get the system share sheet; elsewhere the text goes to the clipboard, and `copied` says what was copied
 * (a result by default, e.g. "Линкът е копиран" for an invite).
 */
export async function shareText(text: string, copied = 'Резултатът е копиран') {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // the player closed the sheet
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast({ kind: 'success', title: copied, body: 'Постави го в чата с приятелите си.' });
  } catch {
    toast({ kind: 'error', title: 'Браузърът не позволи копиране.' });
  }
}
