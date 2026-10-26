import { AVATARS, FRAMES, type GamePlayer, type Requirement, START_RATING, TITLES } from '@quiz/shared';
import { shuffle } from '../questions';

export interface BotBrain {
  /** Base chance of answering correctly on a medium question. */
  accuracy: number;
  /** Typical fraction of the timer used before answering. */
  pace: number;
}

export interface Bot {
  player: GamePlayer;
  brain: BotBrain;
}

const NAMES = [
  'Знайко',
  'Умко',
  'Бързака',
  'Профа',
  'Енцикло',
  'Отговорко',
  'Мозъчко',
  'Светкавицата',
  'Гуглето',
  'Чичо Уики',
  'Нинджата',
  'Сократ',
  'Капитан Факт',
  'Шерлок',
  'Айнщайнчо',
  'Жокера',
  'Пухчо',
  'Тиквичка',
  'Котарака',
  'Лешникотрошачката',
  'Кварк',
  'Пиксел',
];

const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];

/**
 * Something a player of this level could wear (unlocked by level, not by an achievement or a season): a level-2 bot in
 * a level-9 frame gave itself away.
 */
function wearable<T extends { id: string; req: Requirement }>(items: readonly T[], level: number): string {
  const open = items.filter((item) => 'level' in item.req && item.req.level <= level);
  return pick(open.length ? open : items.filter((item) => 'level' in item.req && item.req.level <= 1)).id;
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

let botSeq = 0;

/** Bots never rate higher than this: beyond it, climbing has to come from beating people. */
export const BOT_MAX_RATING = 1600;
const BOT_MIN_RATING = 700;
const jitter = (spread: number) => (Math.random() * 2 - 1) * spread;

/**
 * Bots sized to the humans they play against. A bot plays as strong as the rating it shows, so Elo against bots
 * settles where the player's skill really is instead of climbing forever. Players new to multiplayer get slightly
 * kinder bots for their first few matches.
 */
export function makeBots(
  count: number,
  around: { level: number; rating: number },
  takenNames: string[] = [],
  opts: { gentle?: boolean } = {},
): Bot[] {
  const names = shuffle(NAMES.filter((n) => !takenNames.includes(n)));
  return Array.from({ length: count }, (_, i) => {
    const rating = Math.round(clamp(around.rating + jitter(60), BOT_MIN_RATING, BOT_MAX_RATING));
    const skill = rating - START_RATING;
    const level = clamp(Math.round(around.level + jitter(3)), 1, 60);
    return {
      player: {
        id: `b${++botSeq}`,
        userId: null,
        name: names[i % names.length],
        level,
        isBot: true,
        isGuest: false,
        rating,
        avatar: wearable(AVATARS, level),
        frame: wearable(FRAMES, level),
        title: wearable(TITLES, level),
        team: null,
      },
      brain: {
        accuracy: clamp(0.5 + skill * 0.0006 + jitter(0.05) - (opts.gentle ? 0.1 : 0), 0.3, 0.92),
        pace: clamp(0.5 - skill * 0.0003 + jitter(0.1), 0.18, 0.75),
      },
    };
  });
}
