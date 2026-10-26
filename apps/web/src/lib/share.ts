import { fmt, ordinal, type ReviewItem, toast } from '@quiz/client';
import { BRAND, dayKey } from '@quiz/shared';

const storageKey = (day: string) => `quiz:daily-share:${day}`;

/**
 * The day's result as a spoiler-free emoji line, Wordle-style:
 *   ⚡ АЛМАНАХ · 25.10.2026
 *   🟩🟩🟥🟩🟩🟥🟩🟩🟩🟩 8/10
 *   🔥 5 дни подред
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
  if (streak > 1) lines.push(`🔥 ${streak} дни подред`);
  lines.push(BRAND.domain);
  return lines.join('\n');
}

/** Right and wrong as squares, in order: what a match was like, without giving a question away. */
const squares = (history: ReviewItem[]) => history.map((h) => (h.right ? '🟩' : '🟥')).join('');

/**
 * A finished match as a few lines to send: what happened (a crown, a win, a place; right answers in a category for a
 * solo game), the score, the squares, a new level, and where to play — every share is an invitation.
 */
export function matchShareText(m: {
  modeName: string;
  /** The category of a solo game. */
  category: string | null;
  place: number;
  players: number;
  won: boolean;
  teams: boolean;
  royale: boolean;
  score: number;
  history: ReviewItem[];
  total: number;
  /** The level reached, when this match went up one. */
  levelUp: number | null;
}): string {
  const right = m.history.filter((h) => h.right).length;
  const score = `${fmt(m.score)} т.`;
  const headline =
    m.players === 1
      ? `🎯 ${right}/${m.total} в „${m.category ?? m.modeName}“ · ${score}`
      : m.won
        ? m.royale
          ? `👑 Оцелях до края в ${m.modeName} · ${score}`
          : m.teams
            ? `🤝 Отборна победа в ${m.modeName} · ${score}`
            : `🏆 Победа в ${m.modeName} · ${score}`
        : // Second of two (or the other team) needs no saying: the score does the talking.
          m.teams
          ? `🤝 ${m.modeName} · ${score}`
          : m.players === 2
            ? `⚔️ ${m.modeName} · ${score}`
            : `${ordinal(m.place)} място от ${m.players} в ${m.modeName} · ${score}`;
  const lines = [`⚡ ${BRAND.name}`, headline];
  if (m.history.length) lines.push(squares(m.history));
  if (m.levelUp) lines.push(`⬆️ Ниво ${m.levelUp}`);
  lines.push(`Можеш ли повече? ${BRAND.domain}`);
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
