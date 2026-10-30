import type { CategoryChoice } from './categories';
import type { Formats } from './formats';
import type { Difficulty } from './protocol';

export type QueueModeId = 'duel' | 'teams' | 'squad' | 'royale';
/**
 * `trio`: a queue of three, merged into Арена (3–5) on 2026-10-29; its matches stay in the players' history. `evening`:
 * the evening Роял (EVENING), one big match a day at a set time.
 */
export type ModeId = 'solo' | 'daily' | 'challenge' | 'review' | QueueModeId | 'trio' | 'evening' | 'custom';

export interface ModeDef {
  id: ModeId;
  name: string;
  /** Short badge text, e.g. "1 на 1". */
  short: string;
  /** Seats in a match (the most it takes). */
  players: number;
  /**
   * The fewest a match may start with, once the wait for more is up (Арена: 3 of 5); bots make up the rest below it.
   * Without it, bots fill every seat nobody took.
   */
  minPlayers?: number;
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
  /**
   * Picture questions a match may hold, and whether one is an order question (four taps want a longer clock than
   * Роял's rhythm allows; the daily has one on Mondays).
   */
  formats: Formats;
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
    formats: { images: 2, order: true },
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
    formats: { images: 1, order: false },
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
    formats: { images: 1, order: true },
    tagline: 'Твоите 10 въпроса. Кой ще те бие?',
    description: 'Изиграй 10 въпроса и прати линка: всеки, който го отвори, играе същите въпроси веднъж. Без козове.',
    accent: ['#a5b4fc', '#8b5cf6'],
  },
  review: {
    id: 'review',
    name: 'Поправителен',
    short: 'ПОВТОРИ',
    players: 1,
    questions: 10,
    timeMs: 15_000,
    elimination: false,
    teams: false,
    final: false,
    rounds: false,
    formats: { images: 0, order: false },
    tagline: 'Сгрешеното се връща. Този път го знаеш.',
    description: 'Въпросите, които сгреши, се връщат след 3, 7 и 21 дни. Познатите влизат в „Моят алманах“.',
    accent: ['#fcd34d', '#10b981'],
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
    formats: { images: 2, order: true },
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
    formats: { images: 2, order: true },
    tagline: 'Ти и приятел срещу друга двойка.',
    description: 'Покани приятел и играйте заедно срещу друга двойка (хора или ботове). Точките на двамата се събират.',
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
    formats: { images: 2, order: true },
    tagline: 'Трима влизат. Един взима короната.',
    description: 'Класирана битка на трима — всеки срещу всеки. Вече е част от „Арена“.',
    accent: ['#c084fc', '#7c3aed'],
  },
  squad: {
    id: 'squad',
    name: 'Арена',
    short: '3–5 играчи',
    players: 5,
    minPlayers: 3,
    questions: 10,
    timeMs: 15_000,
    elimination: false,
    teams: false,
    final: true,
    rounds: true,
    formats: { images: 2, order: true },
    tagline: 'До петима на арената. Последният избира.',
    description:
      'Класирана битка на трима до петима в три рунда: категорията на следващия избира последният. Финал с число.',
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
    formats: { images: 2, order: false },
    tagline: 'Осем влизат. Елиминации. Оцелява един.',
    description: 'На всеки няколко въпроса отпада последният, докато двама не излязат на финала.',
    accent: ['#34d399', '#06b6d4'],
  },
  evening: {
    id: 'evening',
    name: 'Вечерен Роял',
    short: 'до 50',
    players: 50,
    minPlayers: 8,
    questions: 15,
    timeMs: 12_000,
    elimination: true,
    teams: false,
    final: true,
    rounds: false,
    formats: { images: 2, order: false },
    tagline: 'Всяка вечер в 21:00. Всички срещу всички.',
    description:
      'До 50 души наведнъж. След 3-ти, 6-и, 9-и и 12-и въпрос отпадат последните 30%, накрая двама играят финала с число.',
    accent: ['#818cf8', '#f472b6'],
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
    formats: { images: 2, order: true },
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

export const QUEUE_MODES: QueueModeId[] = ['duel', 'teams', 'squad', 'royale'];

/**
 * „Вечерен Роял“: every day at `hour` (Sofia time) one big match, its lobby open `lobbyMinutes` before. Up to
 * `maxPlayers` in a match (more make more matches); bots only make up to MODES.evening.minPlayers. After each of the
 * `cuts` the bottom `share` go out (at least one) — fewer the first time, and not before the 4th question: one slow
 * start on a phone is no reason to end the evening — and after `finalTwoAfter` all but two, who play the last two
 * questions. The winner of a match of `titleFrom` people or more wears „Шампион на вечерта“ for `titleHours`;
 * `winsForFrame` such wins earn a frame; the night's `top` stay on the home page until the next one.
 */
export const EVENING = {
  hour: 21,
  lobbyMinutes: 5,
  maxPlayers: 50,
  cuts: [
    { after: 4, share: 0.2 },
    { after: 7, share: 0.3 },
    { after: 10, share: 0.3 },
    { after: 12, share: 0.3 },
  ],
  finalTwoAfter: 13,
  /**
   * People (not bots) in the match for its winner to be champion, count toward the frame, and its places to make the
   * night's top: four beaten at least. Bots make a quiet evening up to eight, and winning that is no title.
   */
  titleFrom: 5,
  titleHours: 24,
  winsForFrame: 3,
  top: 10,
} as const;

/**
 * How many are knocked out after question `n` (1-based) with `active` still in: one at each question of `schedule` —
 * or, in the evening Роял, the bottom share at each of EVENING.cuts and all but the final two after
 * EVENING.finalTwoAfter. Never below two.
 */
export function knockoutsAfter(mode: ModeId, schedule: readonly number[], n: number, active: number): number {
  if (active <= 2) return 0;
  if (mode === 'evening') {
    if (n === EVENING.finalTwoAfter) return active - 2;
    const cut = EVENING.cuts.find((c) => c.after === n);
    if (!cut) return 0;
    return Math.min(active - 2, Math.max(1, Math.round(active * cut.share)));
  }
  return schedule.includes(n) ? 1 : 0;
}

/**
 * Ranked queues open to everyone: all of them (the full review, 2026-10-28). The server can close some (PUBLIC_QUEUES)
 * and tells clients which are open in the lobby stats.
 */
export const DEFAULT_OPEN_QUEUES: QueueModeId[] = QUEUE_MODES;

export function isQueueMode(value: unknown): value is QueueModeId {
  return QUEUE_MODES.includes(value as QueueModeId);
}

export const TEAMS = [
  { name: 'Сините', color: '#38bdf8' },
  { name: 'Червените', color: '#fb7185' },
] as const;

export type TeamId = 0 | 1;

/**
 * Each team's score from its members' (`[team, score]` for everyone on one, those who left too): their sum, and for
 * the smaller side of unequal teams (a room may start 3 against 2) the sum as if it had as many as the larger one — its
 * average per member times the larger side's size — so one more player is no head start.
 */
export function teamPoints(members: Iterable<readonly [TeamId, number]>): [number, number] {
  const sums: [number, number] = [0, 0];
  const sizes: [number, number] = [0, 0];
  for (const [team, score] of members) {
    sums[team] += score;
    sizes[team]++;
  }
  const most = Math.max(...sizes);
  return [0, 1].map((t) => (sizes[t] ? Math.round((sums[t] * most) / sizes[t]) : 0)) as [number, number];
}

export interface RoomSettings {
  maxPlayers: number;
  questions: number;
  timeMs: number;
  /** One category (the host's pick), or a mix of them all. */
  category: CategoryChoice;
  /** With the mix: in ROUNDS, whoever is last picks each round's category (10 questions: three rounds and the final). */
  rounds: boolean;
  /** The last question is a number to guess (when the bank has one). */
  final: boolean;
  /** „Картини“: every question about a picture, as far as the bank has them (not with rounds). */
  pictures: boolean;
  elimination: boolean;
  teams: boolean;
  /** The host plays too; off, they run the game on a big screen („Само водя“) while the others answer on phones. */
  hostPlays: boolean;
  /**
   * The host's own question set to play instead of the bank („Моите въпроси“): all its questions, in its order (the
   * question count, categories and final don't apply).
   */
  set: { id: number; name: string; questions: number } | null;
}

export const ROOM_LIMITS = {
  maxPlayers: [2, 40],
  questions: [5, 10, 15, 20],
  /** Up to a minute: a class with a pupil who reads slowly, or answers with a switch, has the time it needs. */
  timeMs: [10_000, 15_000, 20_000, 30_000, 45_000, 60_000],
  /** Knockouts one at a time only work for a few: with them on, a room takes at most this many. */
  eliminationPlayers: 8,
} as const;

/** A match in ROUNDS has this many questions: the rounds, then the final. */
export const ROUNDS_QUESTIONS = ROUNDS.size * ROUNDS.count + 1;

/** Digits in a room's code: few enough to read out to a class, and with 900,000 codes too slow to guess one. */
export const ROOM_CODE_DIGITS = 6;

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  questions: 10,
  timeMs: 15_000,
  category: 'mixed',
  rounds: false,
  final: true,
  pictures: false,
  elimination: false,
  teams: false,
  hostPlays: true,
  set: null,
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
