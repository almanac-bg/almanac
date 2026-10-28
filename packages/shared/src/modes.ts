import type { CategoryChoice } from './categories';
import type { Difficulty } from './protocol';

export type QueueModeId = 'duel' | 'teams' | 'trio' | 'squad' | 'royale';
export type ModeId = 'solo' | 'daily' | 'challenge' | QueueModeId | 'custom';

export interface ModeDef {
  id: ModeId;
  name: string;
  /** Short badge text, e.g. "1 на 1". */
  short: string;
  players: number;
  questions: number;
  timeMs: number;
  /** Lowest scorer is knocked out at intervals until two remain. */
  elimination: boolean;
  /** Two teams; a team's score is the sum of its players'. */
  teams: boolean;
  /** The last question is a number to guess (when the bank has one to give). */
  final: boolean;
  /** Played in ROUNDS: whoever is behind picks the next round's category. */
  rounds: boolean;
  tagline: string;
  description: string;
  accent: [string, string];
}

export const MODES: Record<ModeId, ModeDef> = {
  solo: {
    id: 'solo',
    name: 'Соло',
    short: 'СОЛО',
    players: 1,
    questions: 10,
    timeMs: 15_000,
    elimination: false,
    teams: false,
    final: true,
    rounds: false,
    tagline: 'Тренирай ума. Гони рекорда си.',
    description: '10 въпроса от категория по избор. Само ти и часовникът.',
    accent: ['#22d3ee', '#6366f1'],
  },
  daily: {
    id: 'daily',
    name: 'Въпросите на деня',
    short: 'ДНЕС',
    players: 1,
    questions: 10,
    timeMs: 15_000,
    elimination: false,
    teams: false,
    final: true,
    rounds: false,
    tagline: 'Едни и същи 10 въпроса за цяла България. Един опит.',
    description: 'Без козове. Класирането се нулира в полунощ.',
    accent: ['#fde047', '#f97316'],
  },
  challenge: {
    id: 'challenge',
    name: 'Предизвикателство',
    short: 'ЛИНК',
    players: 1,
    questions: 10,
    timeMs: 15_000,
    elimination: false,
    teams: false,
    final: true,
    rounds: false,
    tagline: 'Твоите 10 въпроса. Кой ще те бие?',
    description: 'Изиграй 10 въпроса и прати линка: всеки, който го отвори, играе същите въпроси веднъж. Без козове.',
    accent: ['#a5b4fc', '#8b5cf6'],
  },
  duel: {
    id: 'duel',
    name: 'Дуел',
    short: '1 на 1',
    players: 2,
    questions: 10,
    timeMs: 15_000,
    elimination: false,
    teams: false,
    final: true,
    rounds: true,
    tagline: 'Лице в лице. Печели по-бързият ум.',
    description: 'Три рунда по три въпроса: категорията на всеки следващ избира изоставащият. Финал с число.',
    accent: ['#f472b6', '#e11d48'],
  },
  teams: {
    id: 'teams',
    name: 'Отбори',
    short: '2 на 2',
    players: 4,
    questions: 10,
    timeMs: 15_000,
    elimination: false,
    teams: true,
    final: true,
    rounds: false,
    tagline: 'Двама срещу двама. Точките се събират.',
    description: 'Класиран отборен мач. Отборите се балансират по рейтинг.',
    accent: ['#38bdf8', '#fb7185'],
  },
  trio: {
    id: 'trio',
    name: 'Трио',
    short: '3 играчи',
    players: 3,
    questions: 10,
    timeMs: 15_000,
    elimination: false,
    teams: false,
    final: true,
    rounds: false,
    tagline: 'Трима влизат. Един взима короната.',
    description: 'Класирана битка на трима — всеки срещу всеки.',
    accent: ['#c084fc', '#7c3aed'],
  },
  squad: {
    id: 'squad',
    name: 'Арена',
    short: '5 играчи',
    players: 5,
    questions: 12,
    timeMs: 15_000,
    elimination: false,
    teams: false,
    final: true,
    rounds: false,
    tagline: 'Петима на арената. Всяка точка тежи.',
    description: 'Класирана битка на петима в 12 въпроса.',
    accent: ['#fbbf24', '#f97316'],
  },
  royale: {
    id: 'royale',
    name: 'Роял',
    short: '8 играчи',
    players: 8,
    questions: 15,
    timeMs: 12_000,
    elimination: true,
    teams: false,
    final: true,
    rounds: false,
    tagline: 'Осем влизат. Елиминации. Оцелява един.',
    description: 'На всеки няколко въпроса отпада последният, докато двама не излязат на финала.',
    accent: ['#34d399', '#06b6d4'],
  },
  custom: {
    id: 'custom',
    name: 'Частна стая',
    short: 'СТАЯ',
    players: 8,
    questions: 10,
    timeMs: 15_000,
    elimination: false,
    teams: false,
    final: false,
    rounds: false,
    tagline: 'Твоите приятели. Твоите правила.',
    description: 'Покани приятели с код, настрой играта и добави ботове.',
    accent: ['#e879f9', '#22d3ee'],
  },
};

/**
 * Дуел in rounds of three questions, each on one category: the first drawn at random, and before each of the others
 * whoever is behind on points (on a tie, the lower-rated) picks from three categories not played yet, within
 * `pickMs` (else it's drawn). The match still ramps up: `difficulty` per round. A number final follows.
 */
export const ROUNDS = {
  size: 3,
  count: 3,
  offer: 3,
  pickMs: 5_000,
  difficulty: [
    ['easy', 'easy', 'medium'],
    ['easy', 'medium', 'medium'],
    ['medium', 'hard', 'hard'],
  ] as const satisfies readonly (readonly Difficulty[])[],
} as const;

export const QUEUE_MODES: QueueModeId[] = ['duel', 'teams', 'trio', 'squad', 'royale'];

/**
 * Ranked queues open to everyone. While few people play, fewer queues mean people meet each other instead of bots;
 * the server can open more (PUBLIC_QUEUES) and tells clients which are open in the lobby stats.
 */
export const DEFAULT_OPEN_QUEUES: QueueModeId[] = ['duel', 'royale'];

export function isQueueMode(value: unknown): value is QueueModeId {
  return QUEUE_MODES.includes(value as QueueModeId);
}

export const TEAMS = [
  { name: 'Сините', color: '#38bdf8' },
  { name: 'Червените', color: '#fb7185' },
] as const;

export type TeamId = 0 | 1;

export interface RoomSettings {
  maxPlayers: number;
  questions: number;
  timeMs: number;
  category: CategoryChoice;
  elimination: boolean;
  teams: boolean;
}

export const ROOM_LIMITS = {
  maxPlayers: [2, 8],
  questions: [5, 10, 15, 20],
  timeMs: [10_000, 15_000, 20_000, 30_000],
} as const;

/** Digits in a room's code: few enough to read out to a class, and with 900,000 codes too slow to guess one. */
export const ROOM_CODE_DIGITS = 6;

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  questions: 10,
  timeMs: 15_000,
  category: 'mixed',
  elimination: false,
  teams: false,
};

/**
 * 1-based question numbers after which the lowest active player is eliminated. Spreads (players - 2) eliminations
 * from question 4 (one unlucky opener shouldn't send anyone home; from 3 when a short match has no room otherwise) to
 * the second-to-last slot, so the final two always get a head-to-head finale.
 */
export function eliminationSchedule(players: number, questions: number): number[] {
  const last = questions - 2;
  const first = Math.max(3, Math.min(4, last - (players - 2) + 1));
  if (players <= 2 || last < first) return [];
  const count = Math.min(players - 2, last - first + 1);
  if (count === 1) return [last];
  const step = (last - first) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(first + i * step));
}
