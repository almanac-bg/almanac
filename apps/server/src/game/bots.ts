import { AVATARS, FRAMES, type GamePlayer, START_RATING, TITLES } from '@quiz/shared';
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

const STARTER_AVATARS = AVATARS.filter((a) => 'level' in a.req && a.req.level <= 9);
const STARTER_FRAMES = FRAMES.filter((f) => 'level' in f.req && f.req.level <= 9);
const STARTER_TITLES = TITLES.filter((t) => 'level' in t.req && t.req.level <= 8);

const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];
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
    return {
      player: {
        id: `b${++botSeq}`,
        userId: null,
        name: names[i % names.length],
        level: clamp(Math.round(around.level + jitter(3)), 1, 60),
        isBot: true,
        rating,
        avatar: pick(STARTER_AVATARS).id,
        frame: pick(STARTER_FRAMES).id,
        title: pick(STARTER_TITLES).id,
        team: null,
      },
      brain: {
        accuracy: clamp(0.5 + skill * 0.0006 + jitter(0.05) - (opts.gentle ? 0.1 : 0), 0.3, 0.92),
        pace: clamp(0.5 - skill * 0.0003 + jitter(0.1), 0.18, 0.75),
      },
    };
  });
}
