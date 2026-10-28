import {
  CATEGORIES,
  type CategoryId,
  dayEndsAt,
  dayKey,
  levelFromXp,
  type ModeId,
  type QuestsInfo,
  type QueueModeId,
  type XpLine,
} from '@quiz/shared';
import { config } from './config';
import { all, one, run } from './db';
import { seededRng } from './questions';
import { getUser } from './users';

/** What a finished match did toward the day's quests. */
export interface QuestEvent {
  mode: ModeId;
  multiplayer: boolean;
  won: boolean;
  correct: number;
  hardCorrect: number;
  bestStreak: number;
  jokers: number;
  correctByCategory: Map<CategoryId, number>;
}

interface QuestDef {
  id: string;
  icon: string;
  text: string;
  goal: number;
  xp: number;
  /** How far one match moves it. */
  count: (e: QuestEvent) => number;
  /** Counts the best single match instead of adding matches up (e.g. a streak). */
  best?: boolean;
}

/** Finishing all three quests of the day. */
export const QUEST_BONUS_XP = 100;
const BONUS = 'bonus';

const categoryQuest = (c: (typeof CATEGORIES)[number]): QuestDef => ({
  id: `cat:${c.id}`,
  icon: c.icon,
  text: `Отговори вярно на 6 въпроса от „${c.name}“`,
  goal: 6,
  xp: 80,
  count: (e) => e.correctByCategory.get(c.id) ?? 0,
});

/** From this level on, the quests that take some skill or a certain category; before it, ones a first day can finish. */
const SEASONED = 3;

/**
 * One quest from each slot: showing up, playing well, and trying something different. `level`/`below`: from that level
 * on, or only under it (the starter ones). `account`: only for players with an account (a guest can't make a challenge
 * link, so couldn't finish it alone).
 */
const SLOTS: { level?: number; below?: number; queue?: QueueModeId; account?: true; def: QuestDef }[][] = [
  [
    { def: { id: 'play3', icon: '🎮', text: 'Изиграй 3 мача', goal: 3, xp: 60, count: () => 1 } },
    {
      def: {
        id: 'mp2',
        icon: '⚔️',
        text: 'Изиграй 2 мултиплейър мача',
        goal: 2,
        xp: 70,
        count: (e) => (e.multiplayer ? 1 : 0),
      },
    },
    {
      def: {
        id: 'daily',
        icon: '🗓️',
        text: 'Изиграй дневното предизвикателство',
        goal: 1,
        xp: 60,
        count: (e) => (e.mode === 'daily' ? 1 : 0),
      },
    },
  ],
  [
    {
      below: SEASONED,
      def: {
        id: 'correct15',
        icon: '✅',
        text: 'Отговори вярно на 15 въпроса',
        goal: 15,
        xp: 80,
        count: (e) => e.correct,
      },
    },
    {
      level: SEASONED,
      def: {
        id: 'correct25',
        icon: '✅',
        text: 'Отговори вярно на 25 въпроса',
        goal: 25,
        xp: 80,
        count: (e) => e.correct,
      },
    },
    {
      level: SEASONED,
      def: {
        id: 'hard4',
        icon: '🧠',
        text: 'Отговори вярно на 4 трудни въпроса',
        goal: 4,
        xp: 80,
        count: (e) => e.hardCorrect,
      },
    },
    {
      level: SEASONED,
      def: {
        id: 'streak6',
        icon: '🔥',
        text: 'Направи серия от 6 верни отговора в един мач',
        goal: 6,
        xp: 80,
        best: true,
        count: (e) => e.bestStreak,
      },
    },
    {
      level: SEASONED,
      def: {
        id: 'win2',
        icon: '🏆',
        text: 'Спечели 2 мултиплейър мача',
        goal: 2,
        xp: 100,
        count: (e) => (e.multiplayer && e.won ? 1 : 0),
      },
    },
  ],
  [
    ...CATEGORIES.map((c) => ({ level: SEASONED, def: categoryQuest(c) })),
    {
      below: SEASONED,
      def: { id: 'joker1', icon: '🃏', text: 'Изиграй коз в мач', goal: 1, xp: 50, count: (e) => e.jokers },
    },
    {
      queue: 'royale',
      def: {
        id: 'royale',
        icon: '👑',
        text: 'Изиграй мач „Роял“',
        goal: 1,
        xp: 80,
        count: (e) => (e.mode === 'royale' ? 1 : 0),
      },
    },
    {
      level: 2,
      def: { id: 'jokers3', icon: '🃏', text: 'Изиграй 3 коза', goal: 3, xp: 60, count: (e) => e.jokers },
    },
    {
      account: true,
      def: {
        id: 'challenge',
        icon: '🔗',
        text: 'Изиграй предизвикателство по линк',
        goal: 1,
        xp: 70,
        count: (e) => (e.mode === 'challenge' ? 1 : 0),
      },
    },
  ],
];

const DEFS = new Map(SLOTS.flat().map((s) => [s.def.id, s.def]));
const SLOT_OF = new Map(SLOTS.flatMap((slot, i) => slot.map((s) => [s.def.id, i] as const)));

interface Row {
  quest: string;
  progress: number;
  done_at: number | null;
}

/**
 * The player's quests for the day: chosen once (seeded by player and day, from what's available to them at the time)
 * and stored, so they don't change during the day.
 */
function todays(userId: number, day: string): Row[] {
  const rows = all<Row>(
    'SELECT quest, progress, done_at FROM quest_progress WHERE user_id = ? AND day = ?',
    userId,
    day,
  )
    .filter((r) => r.quest !== BONUS)
    .sort((a, b) => (SLOT_OF.get(a.quest) ?? 9) - (SLOT_OF.get(b.quest) ?? 9));
  if (rows.length) return rows;
  const user = getUser(userId);
  const level = levelFromXp(user?.xp ?? 0);
  const guest = user?.is_guest === 1;
  const rng = seededRng(`quests:${day}:${userId}`);
  const picked = SLOTS.map((slot) => {
    const options = slot.filter(
      (s) =>
        (s.level ?? 0) <= level &&
        level < (s.below ?? Number.POSITIVE_INFINITY) &&
        (!s.queue || config.openQueues.includes(s.queue)) &&
        !(s.account && guest),
    );
    return options[Math.floor(rng() * options.length)].def.id;
  });
  for (const quest of picked) {
    run('INSERT OR IGNORE INTO quest_progress (user_id, day, quest) VALUES (?, ?, ?)', userId, day, quest);
  }
  return picked.map((quest) => ({ quest, progress: 0, done_at: null }));
}

export function questsInfo(userId: number, day = dayKey()): QuestsInfo {
  const rows = todays(userId, day);
  return {
    day,
    endsAt: dayEndsAt(day),
    quests: rows
      .map((r) => ({ row: r, def: DEFS.get(r.quest) }))
      .filter((x): x is { row: Row; def: QuestDef } => !!x.def)
      .map(({ row, def }) => ({
        id: def.id,
        icon: def.icon,
        text: def.text,
        goal: def.goal,
        progress: Math.min(row.progress, def.goal),
        xp: def.xp,
        done: row.done_at !== null,
      })),
    bonusXp: QUEST_BONUS_XP,
    bonusDone: !!one(
      'SELECT 1 AS x FROM quest_progress WHERE user_id = ? AND day = ? AND quest = ?',
      userId,
      day,
      BONUS,
    ),
  };
}

/** Moves the day's quests on after a match; returns the XP lines for any it completed (the caller pays them). */
export function advanceQuests(userId: number, event: QuestEvent, day = dayKey()): XpLine[] {
  const lines: XpLine[] = [];
  const now = Date.now();
  let open = 0;
  for (const row of todays(userId, day)) {
    const def = DEFS.get(row.quest);
    if (!def || row.done_at !== null) continue;
    const moved = def.count(event);
    const progress = Math.min(def.goal, def.best ? Math.max(row.progress, moved) : row.progress + moved);
    const done = progress >= def.goal;
    if (progress !== row.progress) {
      run(
        'UPDATE quest_progress SET progress = ?, done_at = ? WHERE user_id = ? AND day = ? AND quest = ?',
        progress,
        done ? now : null,
        userId,
        day,
        row.quest,
      );
    }
    if (done) lines.push({ label: `Задача: ${def.text}`, amount: def.xp });
    else open++;
  }
  if (lines.length && open === 0) {
    const { changes } = run(
      'INSERT OR IGNORE INTO quest_progress (user_id, day, quest, progress, done_at) VALUES (?, ?, ?, 1, ?)',
      userId,
      day,
      BONUS,
      now,
    );
    if (changes) lines.push({ label: 'Всички задачи за деня', amount: QUEST_BONUS_XP });
  }
  return lines;
}
