import { fmt, ordinal, type ReviewItem, toast } from '@quiz/client';
import { BRAND, dayKey, dayNumber, isExact, type NumberInput } from '@quiz/shared';
import { numberText } from '../components/game/numbers';

const storageKey = (day: string) => `quiz:daily-share:${day}`;

/**
 * The day's result, Wordle-style: spoiler-free squares (⬛ a question left unanswered, ⬜ one never reached, 🟨 an order
 * partly in place), the day's
 * number, the score, the place once the board has a crowd to place in, and the link that plays the same questions:
 *   ⚡ АЛМАНАХ №4 · 8/10
 *   🟩🟩🟥🟩⬛🟩🟩🟩🟩🟩
 *   🎯 Финал: ±3
 *   1 240 т. · 7-мо място от 23
 *   🔥 5 дни подред
 *   https://almanac.bg/daily/x7Kp2q
 */
export function dailyShareText(d: {
  history: ReviewItem[];
  total: number;
  day: string;
  score: number;
  /** On the board: its place and how many are on it; off the board, null. */
  place: { rank: number; of: number } | null;
  streak: number;
  /** The player's link to the day's questions; /daily if it couldn't be had. */
  link: string;
}): string {
  const squares = Array.from({ length: d.total }, (_, i) => {
    const item = d.history.find((h) => h.index === i);
    const unanswered = item?.number
      ? item.number.guess === null
      : item?.order
        ? item.order.given === null
        : item?.choice === null;
    return !item ? '⬜' : unanswered ? '⬛' : square(item);
  }).join('');
  const correct = d.history.filter((h) => h.right).length;
  const score = [`${fmt(d.score)} т.`];
  // "1-во място от 3" says more about the day's numbers than about the player.
  if (d.place && d.place.of >= SHOW_PLACE_FROM) score.push(`${ordinal(d.place.rank)} място от ${fmt(d.place.of)}`);
  const lines = [`⚡ ${BRAND.name} №${dayNumber(d.day)} · ${correct}/${d.total}`, squares];
  const final = d.history.find((h) => h.number && h.number.guess !== null)?.number;
  if (final) lines.push(`🎯 Финал: ${finalOff(final.guess!, final.answer, final)}`);
  lines.push(score.join(' · '));
  if (d.streak > 1) lines.push(`🔥 ${d.streak} дни подред`);
  lines.push(d.link);
  return lines.join('\n');
}

/**
 * How close the final was, without giving its answer away: "точно", "±3 км", "×2" (how far, not in which direction).
 */
function finalOff(guess: number, answer: number, n: Pick<NumberInput, 'unit' | 'step' | 'scale'>): string {
  if (isExact(guess, { answer, step: n.step })) return 'точно!';
  if (n.scale === 'log') {
    const factor = Math.max(guess / answer, answer / guess);
    return `×${factor.toLocaleString('bg-BG', { maximumFractionDigits: 1 })}`;
  }
  return `±${numberText(Math.abs(guess - answer), n)}`;
}

/** From how many players on the day's board the share text says the place. */
const SHOW_PLACE_FROM = 10;

/** Right or wrong as a square (🟨: an order with some of it in place). */
const square = (h: ReviewItem) => (h.right ? '🟩' : h.order && h.order.placed > 0 ? '🟨' : '🟥');

/** Right and wrong as squares, in order: what a match was like, without giving a question away. */
const squares = (history: ReviewItem[]) => history.map(square).join('');

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
