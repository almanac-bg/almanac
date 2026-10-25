import {
  QUEUE_MODES,
  type QueueModeId,
  type RankTierId,
  rankFor,
  SEASON_CARRYOVER,
  SEASON_MIN_GAMES,
  SEASON_REWARD_XP,
  type SeasonInfo,
  type SeasonReward,
  START_RATING,
  seasonEndsAt,
  seasonKey,
  seasonName,
  tierIndex,
  type UnlockRef,
} from '@quiz/shared';
import { all, one, run, tx } from './db';

/** Current-season rating; a player's first game of a season starts from a soft reset of their last one. */
export function getRating(userId: number, mode: QueueModeId, season = seasonKey()): number {
  const row = one<{ rating: number }>(
    'SELECT rating FROM season_ratings WHERE user_id = ? AND season = ? AND mode = ?',
    userId,
    season,
    mode,
  );
  if (row) return row.rating;
  const prev = one<{ rating: number }>(
    'SELECT rating FROM season_ratings WHERE user_id = ? AND mode = ? AND season < ? ORDER BY season DESC LIMIT 1',
    userId,
    mode,
    season,
  );
  return prev ? START_RATING + (prev.rating - START_RATING) * SEASON_CARRYOVER : START_RATING;
}

export function getRatings(userId: number): Partial<Record<QueueModeId, number>> {
  return Object.fromEntries(QUEUE_MODES.map((m) => [m, Math.round(getRating(userId, m))]));
}

export function recordRating(userId: number, mode: QueueModeId, rating: number, won: boolean) {
  run(
    `INSERT INTO season_ratings (user_id, season, mode, rating, peak, games, wins) VALUES (?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT (user_id, season, mode) DO UPDATE SET rating = excluded.rating, peak = MAX(peak, excluded.rating),
       games = games + 1, wins = wins + excluded.wins`,
    userId,
    seasonKey(),
    mode,
    rating,
    rating,
    won ? 1 : 0,
  );
}

/** Best tier index the player ever finished a season at (-1 if none) — gates season cosmetics. */
export function bestSeasonTier(userId: number): number {
  const rows = all<{ tier: RankTierId | null }>('SELECT tier FROM season_rewards WHERE user_id = ?', userId);
  return Math.max(-1, ...rows.filter((r) => r.tier).map((r) => tierIndex(r.tier!)));
}

interface RewardRow {
  season: string;
  tier: RankTierId | null;
  xp: number;
  unlocks: string;
}

const toReward = (r: RewardRow): SeasonReward => ({
  season: r.season,
  tier: r.tier,
  xp: r.xp,
  unlocks: JSON.parse(r.unlocks) as UnlockRef[],
});

/**
 * Settles every finished season the player took part in. Runs lazily (on /me), so no cron is needed.
 * `onGranted` gets the XP to add and the tier index reached, inside the same transaction.
 */
export function settleSeasons(
  userId: number,
  unlocksFor: (seasonTier: number) => UnlockRef[],
  addXp: (xp: number) => void,
): SeasonReward[] {
  // The best peak among the modes played enough: a lucky streak of three games doesn't make a season.
  const finished = all<{ season: string; peak: number | null }>(
    `SELECT season, MAX(CASE WHEN games >= ? THEN peak END) AS peak FROM season_ratings
     WHERE user_id = ? AND season < ? AND season NOT IN (SELECT season FROM season_rewards WHERE user_id = ?)
     GROUP BY season ORDER BY season`,
    SEASON_MIN_GAMES,
    userId,
    seasonKey(),
    userId,
  );
  if (!finished.length) return [];
  return tx(() =>
    finished.map((s) => {
      const tier = s.peak !== null ? rankFor(s.peak).id : null;
      const xp = tier ? SEASON_REWARD_XP[tier] : 0;
      const unlocks = tier ? unlocksFor(tierIndex(tier)) : [];
      run(
        'INSERT INTO season_rewards (user_id, season, tier, xp, unlocks, granted_at) VALUES (?, ?, ?, ?, ?, ?)',
        userId,
        s.season,
        tier,
        xp,
        JSON.stringify(unlocks),
        Date.now(),
      );
      if (xp) addXp(xp);
      return { season: s.season, tier, xp, unlocks };
    }),
  );
}

export function unseenSeasonRewards(userId: number): SeasonReward[] {
  return all<RewardRow>(
    'SELECT season, tier, xp, unlocks FROM season_rewards WHERE user_id = ? AND seen = 0 ORDER BY season',
    userId,
  ).map(toReward);
}

export function markSeasonRewardsSeen(userId: number) {
  run('UPDATE season_rewards SET seen = 1 WHERE user_id = ?', userId);
}

export function seasonHistory(userId: number) {
  return all<{ season: string; tier: RankTierId | null; xp: number }>(
    'SELECT season, tier, xp FROM season_rewards WHERE user_id = ? ORDER BY season DESC',
    userId,
  );
}

export function seasonInfo(userId: number): SeasonInfo {
  const id = seasonKey();
  const rows = all<{ mode: QueueModeId; rating: number; peak: number; games: number; wins: number }>(
    'SELECT mode, rating, peak, games, wins FROM season_ratings WHERE user_id = ? AND season = ?',
    userId,
    id,
  );
  return {
    id,
    name: seasonName(id),
    endsAt: seasonEndsAt(id),
    modes: QUEUE_MODES.map((mode) => {
      const r = rows.find((x) => x.mode === mode);
      const rating = Math.round(r?.rating ?? getRating(userId, mode));
      return { mode, rating, peak: Math.round(r?.peak ?? rating), games: r?.games ?? 0, wins: r?.wins ?? 0 };
    }),
    history: seasonHistory(userId),
  };
}
