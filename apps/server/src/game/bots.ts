import { AVATARS, FRAMES, type GamePlayer, TITLES } from '@quiz/shared';
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
  'Знайко', 'Умко', 'Бързака', 'Профа', 'Енцикло', 'Отговорко', 'Мозъчко', 'Светкавицата',
  'Гуглето', 'Чичо Уики', 'Нинджата', 'Сократ', 'Капитан Факт', 'Шерлок', 'Айнщайнчо',
  'Жокера', 'Пухчо', 'Тиквичка', 'Котарака', 'Лешникотрошачката', 'Кварк', 'Пиксел',
];

const STARTER_AVATARS = AVATARS.filter((a) => 'level' in a.req && a.req.level <= 9);
const STARTER_FRAMES = FRAMES.filter((f) => 'level' in f.req && f.req.level <= 9);
const STARTER_TITLES = TITLES.filter((t) => 'level' in t.req && t.req.level <= 8);

const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

let botSeq = 0;

/** Bots sized to roughly match the humans they play against. */
export function makeBots(count: number, around: { level: number; rating: number }, takenNames: string[] = []): Bot[] {
  const names = shuffle(NAMES.filter((n) => !takenNames.includes(n)));
  return Array.from({ length: count }, (_, i) => {
    const level = clamp(Math.round(around.level + (Math.random() * 6 - 3)), 1, 60);
    return {
      player: {
        id: `b${++botSeq}`,
        userId: null,
        name: names[i % names.length],
        level,
        isBot: true,
        rating: Math.round(around.rating + (Math.random() * 120 - 60)),
        avatar: pick(STARTER_AVATARS).id,
        frame: pick(STARTER_FRAMES).id,
        title: pick(STARTER_TITLES).id,
        team: null,
      },
      brain: {
        accuracy: clamp(0.5 + level * 0.008 + (Math.random() * 0.2 - 0.1), 0.4, 0.85),
        pace: 0.25 + Math.random() * 0.35,
      },
    };
  });
}
