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

/** Rated games played in a mode, over every season (forfeits aren't counted: see recordRating). */
export function ratedGames(userId: number, mode: QueueModeId): number {
  return one<{ n: number }>(
    'SELECT COALESCE(SUM(games), 0) AS n FROM season_ratings WHERE user_id = ? AND mode = ?',
    userId,
    mode,
  )!.n;
}

export function getRatings(userId: number): Partial<Record<QueueModeId, number>> {
  return Object.fromEntries(QUEUE_MODES.map((m) => [m, Math.round(getRating(userId, m))]));
}

/**
 * A rated match's new rating. `counted`: played out, not walked out of — a forfeit moves the rating but isn't one of the
 * season's games (ten instant forfeits made a season). The season's reward goes by `reward_peak`: the best rating from
 * its SEASON_MIN_GAMES-th game on, so neither the carry-over nor a lucky first few games make the tier.
 */
export function recordRating(userId: number, mode: QueueModeId, rating: number, won: boolean, counted = true) {
  const games = counted ? 1 : 0;
  run(
    `INSERT INTO season_ratings (user_id, season, mode, rating, peak, games, wins, reward_peak)
     VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? >= ? THEN ? END)
     ON CONFLICT (user_id, season, mode) DO UPDATE SET rating = excluded.rating, peak = MAX(peak, excluded.rating),
       games = games + excluded.games, wins = wins + excluded.wins,
       reward_peak = CASE WHEN games + excluded.games >= ? THEN MAX(COALESCE(reward_peak, excluded.rating), excluded.rating)
         ELSE reward_peak END`,
    userId,
    seasonKey(),
    mode,
    rating,
    rating,
    games,
    won ? 1 : 0,
    games,
    SEASON_MIN_GAMES,
    rating,
    SEASON_MIN_GAMES,
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
  // The best peak among the modes played enough, from the tenth game on: a lucky streak of three games doesn't make a
  // season. (A row older code finished the tenth game on has no reward peak: its peak stands in.)
  const finished = all<{ season: string; peak: number | null }>(
    `SELECT season, MAX(CASE WHEN games >= ? THEN COALESCE(reward_peak, peak) END) AS peak FROM season_ratings
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
