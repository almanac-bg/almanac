import type { CategoryId } from './categories';
import { type CategoryMastery, MASTERY_TITLES } from './mastery';
import { RANK_TIERS, type RankTierId } from './progression';

/**
 * Unlocked by reaching a level, earning an achievement, finishing a season at a rank tier (or higher), earning a
 * category's mastery tier (or higher), or picking it at a level milestone (LEVEL_CHOICES).
 */
export type Requirement =
  | { level: number }
  /** One of two offered at this milestone level (every CHOICE_EVERY): the player picks; the other stays to pick later. */
  | { choice: number }
  | { achievement: string }
  | { season: RankTierId }
  | { mastery: CategoryMastery }
  /** Held while you're the evening Роял's champion (a day after you win it). */
  | { evening: 'champion' };

/**
 * What a player has, for checking requirements. `seasonTier` is the best finished-season tier index (-1 = none);
 * `mastery`, the tier earned in each category (none: not there).
 */
export interface UnlockContext {
  level: number;
  achievements: ReadonlySet<string>;
  seasonTier: number;
  mastery: Partial<Record<CategoryId, number>>;
  /** Won the evening Роял in the last EVENING.titleHours. */
  eveningChampion: boolean;
  /** What the player picked at the level milestones, as choiceKey gives it. */
  chosen: ReadonlySet<string>;
}

export interface AvatarDef {
  id: string;
  name: string;
  emoji: string;
  req: Requirement;
}

export interface FrameDef {
  id: string;
  name: string;
  /** CSS background for the ring around the avatar. */
  background: string;
  animated?: boolean;
  req: Requirement;
}

export interface TitleDef {
  id: string;
  name: string;
  req: Requirement;
}

export interface EmoteDef {
  id: string;
  emoji: string;
  /** Its name in words: what a screen reader says for it (the emoji alone read oddly, or not at all). */
  name: string;
  req: Requirement;
}

export type PowerupId = 'fifty' | 'double' | 'retry';

export interface PowerupDef {
  id: PowerupId;
  name: string;
  /** Under the icon on a phone's bar, where the full name doesn't fit. */
  short: string;
  icon: string;
  description: string;
  /** Not on an easy question: a bet on one is no bet (and every match opens with easy ones). */
  notOnEasy?: boolean;
}

export const AVATARS: AvatarDef[] = [
  { id: 'fox', name: 'Лисица', emoji: '🦊', req: { level: 1 } },
  { id: 'panda', name: 'Панда', emoji: '🐼', req: { level: 1 } },
  { id: 'frog', name: 'Жабок', emoji: '🐸', req: { level: 1 } },
  { id: 'octopus', name: 'Октопод', emoji: '🐙', req: { level: 1 } },
  { id: 'cat', name: 'Коте', emoji: '🐱', req: { level: 1 } },
  { id: 'penguin', name: 'Пингвин', emoji: '🐧', req: { level: 1 } },
  { id: 'owl', name: 'Бухал', emoji: '🦉', req: { level: 2 } },
  { id: 'tiger', name: 'Тигър', emoji: '🐯', req: { level: 3 } },
  { id: 'koala', name: 'Коала', emoji: '🐨', req: { level: 4 } },
  { id: 'unicorn', name: 'Еднорог', emoji: '🦄', req: { level: 5 } },
  { id: 'shark', name: 'Акула', emoji: '🦈', req: { level: 7 } },
  { id: 'dragon', name: 'Дракон', emoji: '🐲', req: { level: 9 } },
  { id: 'alien', name: 'Извънземно', emoji: '👽', req: { level: 11 } },
  { id: 'robot', name: 'Робот', emoji: '🤖', req: { level: 13 } },
  { id: 'lion', name: 'Лъв', emoji: '🦁', req: { level: 16 } },
  { id: 'wizard', name: 'Магьосник', emoji: '🧙', req: { level: 20 } },
  { id: 'ghost', name: 'Призрак', emoji: '👻', req: { level: 25 } },
  { id: 'eagle', name: 'Орел', emoji: '🦅', req: { level: 27 } },
  { id: 'planet', name: 'Планета', emoji: '🪐', req: { level: 30 } },
  { id: 'wolf', name: 'Вълк', emoji: '🐺', req: { level: 33 } },
  { id: 'whale', name: 'Кит', emoji: '🐳', req: { level: 37 } },
  { id: 'trex', name: 'Ти-рекс', emoji: '🦖', req: { level: 40 } },
  { id: 'peacock', name: 'Паун', emoji: '🦚', req: { level: 43 } },
  { id: 'genie', name: 'Джин', emoji: '🧞', req: { level: 46 } },
  { id: 'star', name: 'Суперзвезда', emoji: '🌟', req: { level: 50 } },
  // Past 50 the levels go on (every five take a week or two of regular play): something to reach for to 100.
  { id: 'zmey', name: 'Змей', emoji: '🐉', req: { level: 55 } },
  { id: 'amphora', name: 'Амфора', emoji: '🏺', req: { level: 70 } },
  { id: 'milkyway', name: 'Млечен път', emoji: '🌌', req: { level: 90 } },
  // Picked at the milestones (LEVEL_CHOICES): one of each pair.
  { id: 'hedgehog', name: 'Таралеж', emoji: '🦔', req: { choice: 5 } },
  { id: 'otter', name: 'Видра', emoji: '🦦', req: { choice: 5 } },
  { id: 'turtle', name: 'Костенурка', emoji: '🐢', req: { choice: 20 } },
  { id: 'dolphin', name: 'Делфин', emoji: '🐬', req: { choice: 20 } },
  { id: 'flamingo', name: 'Фламинго', emoji: '🦩', req: { choice: 35 } },
  { id: 'parrot', name: 'Папагал', emoji: '🦜', req: { choice: 35 } },
  { id: 'elephant', name: 'Слон', emoji: '🐘', req: { choice: 50 } },
  { id: 'giraffe', name: 'Жираф', emoji: '🦒', req: { choice: 50 } },
  { id: 'butterfly', name: 'Пеперуда', emoji: '🦋', req: { choice: 65 } },
  { id: 'bee', name: 'Пчела', emoji: '🐝', req: { choice: 65 } },
  { id: 'fairy', name: 'Фея', emoji: '🧚', req: { choice: 80 } },
  { id: 'vampire', name: 'Вампир', emoji: '🧛', req: { choice: 80 } },
  { id: 'superhero', name: 'Супергерой', emoji: '🦸', req: { choice: 95 } },
  { id: 'ninja', name: 'Нинджа', emoji: '🥷', req: { choice: 95 } },
  { id: 'bolt', name: 'Мълния', emoji: '⚡', req: { achievement: 'speed_demon' } },
  { id: 'flame', name: 'Пламък', emoji: '🔥', req: { achievement: 'streak_10' } },
  { id: 'target', name: 'В десетката', emoji: '🎯', req: { achievement: 'perfect' } },
  { id: 'crown', name: 'Корона', emoji: '👑', req: { achievement: 'royale_win' } },
  { id: 'brain', name: 'Голям мозък', emoji: '🧠', req: { achievement: 'correct_1000' } },
  { id: 'goat', name: 'Най-великият', emoji: '🐐', req: { achievement: 'level_50' } },
];

export const FRAMES: FrameDef[] = [
  { id: 'classic', name: 'Класика', background: 'linear-gradient(135deg,#ffffff40,#ffffff12)', req: { level: 1 } },
  { id: 'mint', name: 'Мента', background: 'linear-gradient(135deg,#6ee7b7,#14b8a6)', req: { level: 2 } },
  { id: 'sunset', name: 'Залез', background: 'linear-gradient(135deg,#fb923c,#ec4899)', req: { level: 4 } },
  { id: 'ocean', name: 'Океан', background: 'linear-gradient(135deg,#38bdf8,#6366f1)', req: { level: 6 } },
  { id: 'neon', name: 'Неон', background: 'linear-gradient(135deg,#f0abfc,#22d3ee)', req: { level: 9 } },
  { id: 'toxic', name: 'Токсик', background: 'linear-gradient(135deg,#d9f99d,#22c55e,#065f46)', req: { level: 12 } },
  {
    id: 'gold',
    name: 'Злато',
    background: 'linear-gradient(135deg,#fef3c7,#f59e0b,#fde68a,#b45309)',
    req: { level: 15 },
  },
  {
    id: 'holo',
    name: 'Холограма',
    background: 'conic-gradient(#f472b6,#a78bfa,#22d3ee,#34d399,#facc15,#f472b6)',
    animated: true,
    req: { level: 22 },
  },
  {
    id: 'aurora',
    name: 'Аврора',
    background: 'linear-gradient(135deg,#a7f3d0,#22d3ee,#818cf8,#c084fc)',
    req: { level: 28 },
  },
  {
    id: 'void',
    name: 'Бездна',
    background: 'conic-gradient(#0f0a1f,#7c3aed,#0f0a1f,#22d3ee,#0f0a1f)',
    animated: true,
    req: { level: 35 },
  },
  {
    id: 'magma',
    name: 'Магма',
    background: 'linear-gradient(135deg,#1c1917,#dc2626,#f97316,#fde047)',
    req: { level: 42 },
  },
  {
    id: 'galaxy',
    name: 'Галактика',
    background: 'conic-gradient(#1e1b4b,#c026d3,#1e1b4b,#38bdf8,#f0abfc,#1e1b4b)',
    animated: true,
    req: { level: 45 },
  },
  {
    id: 'amber',
    name: 'Кехлибар',
    background: 'linear-gradient(135deg,#fef3c7,#f59e0b,#78350f,#fbbf24)',
    req: { level: 60 },
  },
  {
    id: 'crystal',
    name: 'Кристал',
    background: 'conic-gradient(#e0f2fe,#ffffff,#a5f3fc,#c7d2fe,#ffffff,#e0f2fe)',
    animated: true,
    req: { level: 80 },
  },
  {
    id: 'eternity',
    name: 'Вечност',
    background: 'conic-gradient(#fde047,#a855f7,#0f0a1f,#22d3ee,#f472b6,#fde047)',
    animated: true,
    req: { level: 100 },
  },
  {
    id: 'inferno',
    name: 'Инферно',
    background: 'conic-gradient(#f97316,#ef4444,#facc15,#f97316)',
    animated: true,
    req: { achievement: 'streak_10' },
  },
  {
    id: 'dawn',
    name: 'Зора',
    background: 'conic-gradient(#fde68a,#fb923c,#f472b6,#a78bfa,#fde68a)',
    animated: true,
    req: { achievement: 'daily_streak_30' },
  },
  {
    id: 'royal',
    name: 'Кралска',
    background: 'linear-gradient(135deg,#fde047,#a855f7,#fde047)',
    req: { achievement: 'royale_win' },
  },
  {
    id: 'prism',
    name: 'Призма',
    background: 'conic-gradient(#ef4444,#f59e0b,#84cc16,#06b6d4,#8b5cf6,#ef4444)',
    animated: true,
    req: { achievement: 'polymath' },
  },
  {
    id: 'season_silver',
    name: 'Сезон: Сребро',
    background: 'linear-gradient(135deg,#f8fafc,#94a3b8,#e2e8f0)',
    req: { season: 'silver' },
  },
  {
    id: 'season_gold',
    name: 'Сезон: Злато',
    background: 'linear-gradient(135deg,#fef9c3,#eab308,#fef08a,#a16207)',
    req: { season: 'gold' },
  },
  {
    id: 'season_platinum',
    name: 'Сезон: Платина',
    background: 'conic-gradient(#ccfbf1,#5eead4,#f0fdfa,#2dd4bf,#ccfbf1)',
    animated: true,
    req: { season: 'platinum' },
  },
  {
    id: 'season_diamond',
    name: 'Сезон: Диамант',
    background: 'conic-gradient(#dbeafe,#60a5fa,#e0f2fe,#818cf8,#dbeafe)',
    animated: true,
    req: { season: 'diamond' },
  },
  {
    id: 'evening_star',
    name: 'Вечерна звезда',
    background: 'conic-gradient(#312e81,#818cf8,#f472b6,#fde68a,#312e81)',
    animated: true,
    req: { achievement: 'evening_3' },
  },
  // Picked at the milestones (LEVEL_CHOICES): one of each pair.
  {
    id: 'lavender',
    name: 'Лавандула',
    background: 'linear-gradient(135deg,#ddd6fe,#a78bfa,#6d28d9)',
    req: { choice: 10 },
  },
  { id: 'coral', name: 'Корал', background: 'linear-gradient(135deg,#fecdd3,#fb7185,#ea580c)', req: { choice: 10 } },
  { id: 'forest', name: 'Гора', background: 'linear-gradient(135deg,#bbf7d0,#22c55e,#14532d)', req: { choice: 25 } },
  {
    id: 'night',
    name: 'Нощно небе',
    background: 'linear-gradient(135deg,#c7d2fe,#4f46e5,#1e1b4b)',
    req: { choice: 25 },
  },
  {
    id: 'silver',
    name: 'Сребро',
    background: 'linear-gradient(135deg,#f8fafc,#94a3b8,#e2e8f0,#475569)',
    req: { choice: 40 },
  },
  {
    id: 'copper',
    name: 'Мед',
    background: 'linear-gradient(135deg,#fed7aa,#ea580c,#fdba74,#7c2d12)',
    req: { choice: 40 },
  },
  {
    id: 'volcano',
    name: 'Вулкан',
    background: 'conic-gradient(#7f1d1d,#ef4444,#f97316,#facc15,#f97316,#7f1d1d)',
    animated: true,
    req: { choice: 55 },
  },
  {
    id: 'glacier',
    name: 'Ледник',
    background: 'conic-gradient(#e0f2fe,#7dd3fc,#0ea5e9,#e0f2fe,#bae6fd,#e0f2fe)',
    animated: true,
    req: { choice: 55 },
  },
  {
    id: 'rose',
    name: 'Розов кварц',
    background: 'linear-gradient(135deg,#fce7f3,#f9a8d4,#fbcfe8,#be185d)',
    req: { choice: 70 },
  },
  {
    id: 'lagoon',
    name: 'Лагуна',
    background: 'linear-gradient(135deg,#ccfbf1,#2dd4bf,#0e7490,#99f6e4)',
    req: { choice: 70 },
  },
  {
    id: 'starry',
    name: 'Звездна нощ',
    background: 'conic-gradient(#1e1b4b,#6366f1,#fde68a,#1e1b4b,#a5b4fc,#1e1b4b)',
    animated: true,
    req: { choice: 85 },
  },
  {
    id: 'blaze',
    name: 'Пламък',
    background: 'conic-gradient(#fef08a,#f97316,#dc2626,#f97316,#fef08a)',
    animated: true,
    req: { choice: 85 },
  },
  {
    id: 'sun',
    name: 'Слънце',
    background: 'conic-gradient(#fffbeb,#fcd34d,#f59e0b,#fffbeb,#fde68a,#d97706,#fffbeb)',
    animated: true,
    req: { choice: 100 },
  },
  {
    id: 'moon',
    name: 'Луна',
    background: 'conic-gradient(#f8fafc,#cbd5e1,#64748b,#f8fafc,#e2e8f0,#334155,#f8fafc)',
    animated: true,
    req: { choice: 100 },
  },
  {
    id: 'season_master',
    name: 'Сезон: Майстор',
    background: 'conic-gradient(#f0abfc,#e879f9,#fde047,#c026d3,#f0abfc)',
    animated: true,
    req: { season: 'master' },
  },
];

export const TITLES: TitleDef[] = [
  { id: 'rookie', name: 'Нова искра', req: { level: 1 } },
  { id: 'curious', name: 'Любопитен ум', req: { level: 3 } },
  { id: 'enthusiast', name: 'Куиз страст', req: { level: 5 } },
  { id: 'buff', name: 'Ерудиция', req: { level: 8 } },
  { id: 'knowitall', name: 'Всезнание', req: { level: 12 } },
  { id: 'mastermind', name: 'Гениален ум', req: { level: 18 } },
  { id: 'encyclopedia', name: 'Ходеща енциклопедия', req: { level: 25 } },
  { id: 'well', name: 'Кладенец от знания', req: { level: 30 } },
  { id: 'oracle', name: 'Оракул', req: { level: 35 } },
  { id: 'library', name: 'Жива библиотека', req: { level: 40 } },
  { id: 'wisdom', name: 'Вековна мъдрост', req: { level: 45 } },
  { id: 'legend', name: 'Жива легенда', req: { level: 50 } },
  { id: 'keeper', name: 'Пазител на знанието', req: { level: 55 } },
  { id: 'walking', name: 'Ходеща енциклопедия', req: { level: 65 } },
  { id: 'deathless', name: 'Безсмъртен ум', req: { level: 75 } },
  { id: 'chronicler', name: 'Летописец', req: { level: 85 } },
  { id: 'almanac', name: 'Жив алманах', req: { level: 100 } },
  // Picked at the milestones (LEVEL_CHOICES): one of each pair.
  { id: 'seeker', name: 'Търсещ ум', req: { choice: 15 } },
  { id: 'nightowl', name: 'Нощна сова', req: { choice: 15 } },
  { id: 'razor', name: 'Ум като бръснач', req: { choice: 30 } },
  { id: 'storm', name: 'Буря от отговори', req: { choice: 30 } },
  { id: 'sharp', name: 'Остър поглед', req: { choice: 45 } },
  { id: 'quiet', name: 'Тиха сила', req: { choice: 45 } },
  { id: 'quick', name: 'Бърза мисъл', req: { choice: 60 } },
  { id: 'spring', name: 'Дълбок извор', req: { choice: 60 } },
  { id: 'quizstar', name: 'Звезда на викторината', req: { choice: 75 } },
  { id: 'heart', name: 'Сърцето на играта', req: { choice: 75 } },
  { id: 'light', name: 'Светлина на знанието', req: { choice: 90 } },
  { id: 'unquenched', name: 'Неугасим пламък', req: { choice: 90 } },
  { id: 'speedster', name: 'Демон на скоростта', req: { achievement: 'speed_demon' } },
  { id: 'unstoppable', name: 'Неудържима серия', req: { achievement: 'streak_10' } },
  { id: 'perfectionist', name: 'Безупречност', req: { achievement: 'perfect' } },
  { id: 'duelist', name: 'Дуелен инстинкт', req: { achievement: 'duelist' } },
  { id: 'survivor', name: 'Короната на Роял', req: { achievement: 'royale_win' } },
  { id: 'polymath', name: 'Всестранен ум', req: { achievement: 'polymath' } },
  { id: 'comeback', name: 'Магията на обрата', req: { achievement: 'comeback' } },
  { id: 'slayer', name: 'Гроза за гигантите', req: { achievement: 'giant_slayer' } },
  { id: 'carry', name: 'Гръбнакът на отбора', req: { achievement: 'team_carry' } },
  { id: 'author', name: 'Златно перо', req: { achievement: 'author_10' } },
  { id: 'daily', name: 'Всеки ден по малко', req: { achievement: 'daily_streak_7' } },
  { id: 'sunrises', name: 'Сто изгрева', req: { achievement: 'daily_streak_100' } },
  // Every season played (any tier): something to keep from Bronze too.
  { id: 'season_bronze', name: 'Сезонен боец', req: { season: 'bronze' } },
  { id: 'season_gold', name: 'Златен сезон', req: { season: 'gold' } },
  { id: 'season_diamond', name: 'Диамантен ум', req: { season: 'diamond' } },
  { id: 'season_master', name: 'Сезонно майсторство', req: { season: 'master' } },
  // Worn by the evening Роял's winner for a day.
  { id: 'evening_champion', name: 'Шампион на вечерта', req: { evening: 'champion' } },
  // „Майстор · История“: one for each category and mastery tier.
  ...MASTERY_TITLES.map((t) => ({ id: t.id, name: t.name, req: { mastery: t.mastery } })),
];

export const EMOTES: EmoteDef[] = [
  { id: 'thumbs', emoji: '👍', name: 'Палец нагоре', req: { level: 1 } },
  { id: 'lol', emoji: '😂', name: 'Смях', req: { level: 1 } },
  { id: 'wow', emoji: '😮', name: 'Учудване', req: { level: 1 } },
  { id: 'fire', emoji: '🔥', name: 'Огън', req: { level: 1 } },
  { id: 'cool', emoji: '😎', name: 'Готино', req: { level: 4 } },
  { id: 'mindblown', emoji: '🤯', name: 'Шок', req: { level: 6 } },
  { id: 'clap', emoji: '👏', name: 'Аплодисменти', req: { level: 8 } },
  { id: 'dead', emoji: '💀', name: 'Умрях от смях', req: { level: 10 } },
  { id: 'salute', emoji: '🫡', name: 'Поздрав', req: { level: 14 } },
  { id: 'clown', emoji: '🤡', name: 'Клоун', req: { level: 18 } },
  { id: 'goat', emoji: '🐐', name: 'Най-великият', req: { level: 24 } },
  { id: 'monocle', emoji: '🧐', name: 'Хм', req: { level: 32 } },
  { id: 'party', emoji: '🥳', name: 'Купон', req: { level: 36 } },
  { id: 'praise', emoji: '🙌', name: 'Браво', req: { level: 44 } },
  { id: 'trophy', emoji: '🏆', name: 'Купа', req: { achievement: 'first_win' } },
  { id: 'huff', emoji: '😤', name: 'Яд', req: { achievement: 'photo_finish' } },
  { id: 'ice', emoji: '🥶', name: 'Хладнокръвно', req: { achievement: 'flawless_duel' } },
  { id: 'handshake', emoji: '🤝', name: 'Ръкостискане', req: { achievement: 'team_win' } },
];

/**
 * Everyone has all three from the first match, wherever козове are played (not the daily, not challenge links: runs
 * everyone compares; not a number question). Bar order, left to right, and the keys Q to E.
 */
export const POWERUPS: PowerupDef[] = [
  { id: 'fifty', name: '50/50', short: '50/50', icon: '✂️', description: 'Премахва два грешни отговора.' },
  {
    id: 'retry',
    name: 'Втори шанс',
    short: 'Шанс',
    icon: '🔁',
    description: 'Ако сгрешиш, имаш още един опит (за половин точки).',
  },
  {
    id: 'double',
    name: 'Двойно или нищо',
    short: 'Двойно',
    icon: '💰',
    description: 'Удвоява точките за среден или труден въпрос, ако отговориш вярно. Ако сгрешиш, губиш 500 точки.',
    notOnEasy: true,
  },
];

export const powerupById = (id: string) => POWERUPS.find((p) => p.id === id);

export type UnlockKind = 'avatar' | 'frame' | 'title' | 'emote';

export interface UnlockRef {
  kind: UnlockKind;
  id: string;
}

const CATALOG: Record<UnlockKind, { id: string; req: Requirement }[]> = {
  avatar: AVATARS,
  frame: FRAMES,
  title: TITLES,
  emote: EMOTES,
};

export const tierIndex = (tier: RankTierId) => RANK_TIERS.findIndex((t) => t.id === tier);

/** How a picked reward is kept (UnlockContext.chosen, the server's level_choices). */
export const choiceKey = (u: UnlockRef) => `${u.kind}:${u.id}`;

/** `key` (choiceKey): which item it is — a reward picked at a milestone is that item's alone. */
export function meetsRequirement(req: Requirement, ctx: UnlockContext, key?: string): boolean {
  if ('level' in req) return ctx.level >= req.level;
  if ('choice' in req) return key !== undefined && ctx.chosen.has(key);
  if ('achievement' in req) return ctx.achievements.has(req.achievement);
  if ('mastery' in req) return (ctx.mastery[req.mastery.category] ?? -1) >= req.mastery.tier;
  if ('evening' in req) return ctx.eveningChampion;
  return ctx.seasonTier >= tierIndex(req.season);
}

export function isUnlocked(kind: UnlockKind, id: string, ctx: UnlockContext): boolean {
  const item = CATALOG[kind].find((i) => i.id === id);
  return !!item && meetsRequirement(item.req, ctx, choiceKey({ kind, id }));
}

export function unlockedIds(kind: UnlockKind, ctx: UnlockContext): string[] {
  return CATALOG[kind].filter((i) => meetsRequirement(i.req, ctx, choiceKey({ kind, id: i.id }))).map((i) => i.id);
}

/** Everything that became available between two progression states. */
export function newlyUnlocked(before: UnlockContext, after: UnlockContext): UnlockRef[] {
  const out: UnlockRef[] = [];
  for (const kind of Object.keys(CATALOG) as UnlockKind[]) {
    for (const item of CATALOG[kind]) {
      const key = choiceKey({ kind, id: item.id });
      if (!meetsRequirement(item.req, before, key) && meetsRequirement(item.req, after, key))
        out.push({ kind, id: item.id });
    }
  }
  return out;
}

/** Next few level-gated rewards, for "coming up" teasers. */
export function upcomingUnlocks(level: number, limit = 3): (UnlockRef & { level: number })[] {
  const out: (UnlockRef & { level: number })[] = [];
  for (const kind of Object.keys(CATALOG) as UnlockKind[]) {
    for (const item of CATALOG[kind]) {
      if ('level' in item.req && item.req.level > level) out.push({ kind, id: item.id, level: item.req.level });
    }
  }
  return out.sort((a, b) => a.level - b.level).slice(0, limit);
}

/** A level milestone's reward: every CHOICE_EVERY levels, one of two (LEVEL_CHOICES). */
export const CHOICE_EVERY = 5;

/**
 * The milestones, from the catalogue's `choice` items: at each, two of one kind. Picking one at a milestone leaves the
 * other to pick at a later one, so nothing is lost for good — a pick is a matter of when, and two players at the same
 * level look different.
 */
export const LEVEL_CHOICES: { level: number; options: UnlockRef[] }[] = (() => {
  const by = new Map<number, UnlockRef[]>();
  for (const kind of Object.keys(CATALOG) as UnlockKind[])
    for (const item of CATALOG[kind])
      if ('choice' in item.req) by.set(item.req.choice, [...(by.get(item.req.choice) ?? []), { kind, id: item.id }]);
  return [...by].sort(([a], [b]) => a - b).map(([level, options]) => ({ level, options }));
})();

/** One milestone's picks: its own two, and those left unpicked at the milestones already decided before it. */
export function choiceOffers(
  level: number,
  picks: ReadonlyMap<number, string>,
): { options: UnlockRef[]; earlier: UnlockRef[] } {
  const taken = new Set(picks.values());
  const options = LEVEL_CHOICES.find((c) => c.level === level)?.options ?? [];
  const earlier = LEVEL_CHOICES.filter((c) => c.level < level && picks.has(c.level)).flatMap((c) =>
    c.options.filter((o) => !taken.has(choiceKey(o))),
  );
  return { options: options.filter((o) => !taken.has(choiceKey(o))), earlier };
}

export const avatarEmoji = (id: string) => AVATARS.find((a) => a.id === id)?.emoji ?? '🦊';
export const frameById = (id: string) => FRAMES.find((f) => f.id === id) ?? FRAMES[0];
export const titleName = (id: string) => TITLES.find((t) => t.id === id)?.name ?? 'Нова искра';
export const emoteById = (id: string) => EMOTES.find((e) => e.id === id);
