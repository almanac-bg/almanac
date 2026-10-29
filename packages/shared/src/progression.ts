/** Total XP needed to reach `level`. L2 = 100, L5 = 1 000, L10 = 4 500, L25 = 30 000. */
export function xpToReach(level: number): number {
  return 50 * (level - 1) * level;
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (xpToReach(level + 1) <= xp) level++;
  return level;
}

export function levelProgress(xp: number) {
  const level = levelFromXp(xp);
  const base = xpToReach(level);
  const next = xpToReach(level + 1);
  return { level, into: xp - base, needed: next - base, pct: (xp - base) / (next - base) };
}

export const SCORING = {
  /** Points for any correct answer. */
  base: 500,
  /** Extra points scaled by how much time was left. */
  speed: 500,
  /** Bonus per consecutive correct answer beyond the first. */
  streakStep: 50,
  streakMax: 250,
  /** What a miss costs with "Двойно или нищо" active. */
  doubleStake: 500,
} as const;

/** The reading window: as long as it takes to read the question and its options, at most this much of the clock. */
export const READING = { baseMs: 400, perCharMs: 30, minMs: 1_000, maxMs: 4_500 } as const;

/**
 * How long a question takes to read, by the length of the question and its options (an answer can't be picked before
 * the options are read): the speed bonus only starts to drain after it, so a fast reader gains nothing over a slow
 * one, and nobody gains by tapping before they've read it.
 */
export function readingMs(question: string, options: readonly string[] = []): number {
  const chars = question.length + options.reduce((sum, o) => sum + o.length, 0);
  return Math.min(READING.maxMs, Math.max(READING.minMs, READING.baseMs + chars * READING.perCharMs));
}

/**
 * What a correct answer scores: the base, the speed bonus for the time left on the clock after the reading window and
 * the streak bonus, doubled by "Двойно или нищо", halved for a "Втори шанс" pick. `streak` counts this answer.
 */
export function answerPoints(a: {
  timeMs: number;
  limitMs: number;
  readMs: number;
  streak: number;
  doubled: boolean;
  retried: boolean;
  /** Solo without a clock: no speed bonus. */
  untimed?: boolean;
}) {
  const drained = Math.max(0, a.timeMs - a.readMs) / Math.max(1, a.limitMs - a.readMs);
  const speed = a.untimed ? 0 : Math.round(SCORING.speed * Math.max(0, 1 - drained));
  const streakBonus = Math.min((a.streak - 1) * SCORING.streakStep, SCORING.streakMax);
  return Math.round((SCORING.base + speed + streakBonus) * (a.doubled ? 2 : 1) * (a.retried ? 0.5 : 1));
}

export const START_RATING = 1000;

/** Win-trading guard: the same two people only move each other's rating this many times a day. */
export const RATED_GAMES_PER_PAIR = 3;

/**
 * A new account plays people unrated until it is this old and has played this many matches (against bots it's rated
 * from the first): a throwaway account to trade wins with costs a day and real play, not ten seconds.
 */
export const RATED_AFTER = { ms: 24 * 60 * 60 * 1000, games: 10 } as const;

export const RANK_TIERS = [
  { id: 'bronze', name: 'Бронз', min: -Infinity, color: '#d4915c' },
  { id: 'silver', name: 'Сребро', min: 1100, color: '#cbd5e1' },
  { id: 'gold', name: 'Злато', min: 1250, color: '#facc15' },
  { id: 'platinum', name: 'Платина', min: 1400, color: '#5eead4' },
  { id: 'diamond', name: 'Диамант', min: 1550, color: '#60a5fa' },
  { id: 'master', name: 'Майстор', min: 1700, color: '#e879f9' },
] as const;

export type RankTier = (typeof RANK_TIERS)[number];
export type RankTierId = RankTier['id'];

/** Season-end XP by the best tier reached in any ranked mode: once a month, so worth noticing next to a day's play. */
export const SEASON_REWARD_XP: Record<RankTierId, number> = {
  bronze: 300,
  silver: 750,
  gold: 1500,
  platinum: 2400,
  diamond: 3600,
  master: 6000,
};
/** Ranked games needed in one mode for its peak to count toward the season's rewards. */
export const SEASON_MIN_GAMES = 10;
/** A new season starts you this fraction of the way from the baseline back to your old rating. */
export const SEASON_CARRYOVER = 0.5;

/** XP for finishing the daily challenge, plus a bonus per streak day (capped). */
/** The streak bonus keeps growing for a month: a long streak is worth protecting. */
export const DAILY_XP = { complete: 50, perStreakDay: 10, streakCap: 30 } as const;

/** A shield for every 7 days in a row (holding at most 2); a missed day uses one up instead of breaking the streak. */
export const STREAK_SHIELDS = { every: 7, max: 2 } as const;

export function rankFor(rating: number): RankTier {
  let tier: RankTier = RANK_TIERS[0];
  for (const t of RANK_TIERS) if (rating >= t.min) tier = t;
  return tier;
}
