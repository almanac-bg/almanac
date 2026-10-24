import { type ReviewItem, toast } from '@quiz/client';
import { BRAND, dayKey } from '@quiz/shared';

const storageKey = (day: string) => `quiz:daily-share:${day}`;

/**
 * The day's result as a spoiler-free emoji line, Wordle-style:
 *   ⚡ АЛМАНАХ · 25.10.2026
 *   🟩🟩🟥🟩🟩🟥🟩🟩🟩🟩 8/10
 *   🔥 5 дни поред
 *   almanac.bg
 */
export function dailyShareText(history: ReviewItem[], total: number, streak: number, day = dayKey()): string {
  const [y, m, d] = day.split('-');
  const squares = Array.from({ length: total }, (_, i) => {
    const item = history.find((h) => h.index === i);
    return item ? (item.right ? '🟩' : '🟥') : '⬜';
  }).join('');
  const correct = history.filter((h) => h.right).length;
  const lines = [`⚡ ${BRAND.name} · ${d}.${m}.${y}`, `${squares} ${correct}/${total}`];
  if (streak > 1) lines.push(`🔥 ${streak} дни поред`);
  lines.push(BRAND.domain);
  return lines.join('\n');
}

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

/** Phones get the system share sheet; elsewhere the text goes to the clipboard. */
export async function shareText(text: string) {
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
    toast({ kind: 'success', title: 'Резултатът е копиран', body: 'Постави го в чата с приятелите си.' });
  } catch {
    toast({ kind: 'error', title: 'Браузърът не позволи копиране.' });
  }
}
