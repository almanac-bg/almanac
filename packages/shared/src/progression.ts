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

export const START_RATING = 1000;

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

/** Season-end XP by the best tier reached in any ranked mode. */
export const SEASON_REWARD_XP: Record<RankTierId, number> = {
  bronze: 100,
  silver: 250,
  gold: 500,
  platinum: 800,
  diamond: 1200,
  master: 2000,
};
/** Ranked games needed in one mode for its peak to count toward the season's rewards. */
export const SEASON_MIN_GAMES = 10;
/** A new season starts you this fraction of the way from the baseline back to your old rating. */
export const SEASON_CARRYOVER = 0.5;

/** XP for finishing the daily challenge, plus a bonus per streak day (capped). */
/** The streak bonus keeps growing for a month: a long streak is worth protecting. */
export const DAILY_XP = { complete: 50, perStreakDay: 10, streakCap: 30 } as const;

export function rankFor(rating: number): RankTier {
  let tier: RankTier = RANK_TIERS[0];
  for (const t of RANK_TIERS) if (rating >= t.min) tier = t;
  return tier;
}
