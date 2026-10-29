import {
  AVATARS,
  CATEGORY_IDS,
  type CategoryId,
  FRAMES,
  type GamePlayer,
  type Requirement,
  START_RATING,
  TITLES,
} from '@quiz/shared';
import { shuffle } from '../questions';

export interface BotBrain {
  /**
   * How much it knows, on the scale questions are rated on (skill.ts): the rating it shows. It gets a question right as
   * often as a person of that skill would (expectedRight), so it misses the questions people miss.
   */
  skill: number;
  /** Typical fraction of the timer used before answering. */
  pace: number;
  /** Categories it knows better (picks first) and worse, by FAVOURITE_LEAN. */
  strong: CategoryId[];
  weak: CategoryId[];
}

/** How much better (or worse) a bot does in its strong (or weak) categories than its skill says. */
export const FAVOURITE_LEAN = 0.15;

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
/**
 * How much weaker a newcomer's bots are, in rating: they show it, and play it. With the rating unchanged and only the
 * play softer, everyone else in the match beat bots rated above how they played and gained rating for it.
 */
const GENTLE_RATING_GAP = 170;
const jitter = (spread: number) => (Math.random() * 2 - 1) * spread;

/**
 * Names for `count` bots, none already in the match: the list in a random order, then the list again numbered
 * („Знайко 2“). A room takes up to 40, more than there are names.
 */
function botNames(count: number, taken: string[]): string[] {
  const used = new Set(taken);
  const names: string[] = [];
  for (let round = 1; names.length < count; round++)
    for (const base of shuffle([...NAMES])) {
      const name = round === 1 ? base : `${base} ${round}`;
      if (used.has(name)) continue;
      used.add(name);
      names.push(name);
      if (names.length === count) break;
    }
  return names;
}

/**
 * Bots sized to the humans they play against: centred on how much they know (`around.skill`, see skillCentre), so a
 * match against them is close. A bot plays as strong as the rating it shows, so Elo against bots settles where the
 * player's skill really is instead of climbing forever. Players new to multiplayer get slightly kinder bots for their
 * first few matches: rated lower, and playing to it. Each has two strong and two weak categories.
 */
export function makeBots(
  count: number,
  around: { level: number; skill: number },
  takenNames: string[] = [],
  opts: { gentle?: boolean } = {},
): Bot[] {
  const names = botNames(count, takenNames);
  return Array.from({ length: count }, (_, i) => {
    const centre = around.skill - (opts.gentle ? GENTLE_RATING_GAP : 0);
    const rating = Math.round(clamp(centre + jitter(60), BOT_MIN_RATING, BOT_MAX_RATING));
    const level = clamp(Math.round(around.level + jitter(3)), 1, 60);
    const [a, b, c, d] = shuffle(CATEGORY_IDS);
    return {
      player: {
        id: `b${++botSeq}`,
        userId: null,
        name: names[i],
        level,
        isBot: true,
        isGuest: false,
        rating,
        avatar: wearable(AVATARS, level),
        frame: wearable(FRAMES, level),
        title: wearable(TITLES, level),
        team: null,
        strong: [a, b],
      },
      brain: {
        skill: rating,
        pace: clamp(0.5 - (rating - START_RATING) * 0.0003 + jitter(0.1), 0.18, 0.75),
        strong: [a, b],
        weak: [c, d],
      },
    };
  });
}
