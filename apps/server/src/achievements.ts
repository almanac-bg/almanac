import {
  ACHIEVEMENTS,
  type AchievementProgress,
  levelFromXp,
  type ModeId,
  START_RATING,
  tierIndex,
  type XpLine,
} from '@quiz/shared';
import { all, one, run } from './db';
import { bestSeasonTier } from './seasons';
import { getUser } from './users';

/** Lifetime numbers achievements are measured against. */
export interface Aggregate {
  gamesPlayed: number;
  mpGames: number;
  wins: number;
  correct: number;
  bestStreak: number;
  fastestCorrectMs: number | null;
  bestSoloScore: number;
  powerupsUsed: number;
  hostedGames: number;
  level: number;
  categoriesCovered: number;
  maxCategoryCorrect: number;
  modeWins: Partial<Record<ModeId, number>>;
  teamWins: number;
  maxRating: number;
  dailyCompleted: number;
  bestDailyStreak: number;
  friends: number;
  freezes: number;
  approvedQuestions: number;
  bestSeasonTier: number;
}

/** What happened in the match that just ended, for one player. */
export interface MatchContext {
  mode: ModeId;
  won: boolean;
  /** Didn't play the match out: walked out, or the other side did before it got going. */
  left: boolean;
  /** Played to the last question (the other side didn't walk out). */
  completed: boolean;
  teams: boolean;
  questions: number;
  faced: number;
  correct: number;
  lastAtHalfway: boolean;
  /** Winning margin over second place, when this player won (solo-scored modes). */
  winMargin: number | null;
  /** Biggest level gap to a human opponent this player finished above. */
  beatLevelGap: number;
  /** Highest individual score in the match. */
  topScorer: boolean;
}

interface Rule {
  progress?: (a: Aggregate) => number;
  earned?: (a: Aggregate, m: MatchContext | null) => boolean;
}

const RULES: Record<string, Rule> = {
  first_game: { progress: (a) => a.gamesPlayed },
  games_10: { progress: (a) => a.gamesPlayed },
  games_100: { progress: (a) => a.gamesPlayed },
  first_win: { progress: (a) => a.wins },
  duelist: { progress: (a) => a.modeWins.duel ?? 0 },
  trio_win: { progress: (a) => a.modeWins.trio ?? 0 },
  squad_win: { progress: (a) => a.modeWins.squad ?? 0 },
  royale_win: { progress: (a) => a.modeWins.royale ?? 0 },
  party_animal: { progress: (a) => a.mpGames },
  host: { progress: (a) => a.hostedGames },
  streak_5: { progress: (a) => a.bestStreak },
  streak_10: { progress: (a) => a.bestStreak },
  speed_demon: { earned: (a) => a.fastestCorrectMs !== null && a.fastestCorrectMs < 1500 },
  perfect: {
    earned: (_, m) => !!m && !m.left && m.questions >= 10 && m.faced === m.questions && m.correct === m.questions,
  },
  correct_100: { progress: (a) => a.correct },
  correct_1000: { progress: (a) => a.correct },
  polymath: { progress: (a) => a.categoriesCovered },
  specialist: { progress: (a) => a.maxCategoryCorrect },
  high_scorer: { progress: (a) => a.bestSoloScore },
  power_player: { progress: (a) => a.powerupsUsed },
  comeback: { earned: (_, m) => !!m && m.won && m.completed && !m.teams && m.lastAtHalfway },
  flawless_duel: { earned: (_, m) => !!m && m.won && m.mode === 'duel' && m.correct === m.questions },
  photo_finish: { earned: (_, m) => !!m && m.won && m.completed && m.winMargin !== null && m.winMargin < 100 },
  giant_slayer: { earned: (_, m) => !!m && !m.left && m.beatLevelGap >= 5 },
  team_win: { progress: (a) => a.teamWins },
  team_carry: { earned: (_, m) => !!m && m.won && m.teams && m.topScorer },
  daily_first: { progress: (a) => a.dailyCompleted },
  daily_streak_7: { progress: (a) => a.bestDailyStreak },
  daily_streak_30: { progress: (a) => a.bestDailyStreak },
  daily_streak_100: { progress: (a) => a.bestDailyStreak },
  daily_perfect: { earned: (_, m) => !!m && !m.left && m.mode === 'daily' && m.correct === m.questions },
  friends_5: { progress: (a) => a.friends },
  freezer: { progress: (a) => a.freezes },
  author_1: { progress: (a) => a.approvedQuestions },
  author_10: { progress: (a) => a.approvedQuestions },
  season_gold: { earned: (a) => a.bestSeasonTier >= tierIndex('gold') },
  level_10: { progress: (a) => a.level },
  level_25: { progress: (a) => a.level },
  level_50: { progress: (a) => a.level },
  rank_gold: { earned: (a) => a.maxRating >= 1250 },
  rank_master: { earned: (a) => a.maxRating >= 1700 },
};

export function loadAggregate(userId: number): Aggregate {
  const u = getUser(userId)!;
  const count = (sql: string, ...params: (number | string)[]) => one<{ n: number }>(sql, ...params)?.n ?? 0;
  const cats = all<{ correct: number }>('SELECT correct FROM category_stats WHERE user_id = ?', userId);
  const modeWins = all<{ mode: ModeId; wins: number }>(
    `SELECT m.mode, COUNT(*) AS wins FROM match_players mp JOIN matches m ON m.id = mp.match_id
     WHERE mp.user_id = ? AND mp.placement = 1 AND m.player_count > 1 AND mp.left_match = 0
     GROUP BY m.mode`,
    userId,
  );
  return {
    gamesPlayed: u.games_played,
    mpGames: u.mp_games,
    wins: u.wins,
    correct: u.correct_answers,
    bestStreak: u.best_streak,
    fastestCorrectMs: u.fastest_correct_ms,
    bestSoloScore: u.best_solo_score,
    powerupsUsed: u.powerups_used,
    hostedGames: u.hosted_games,
    level: levelFromXp(u.xp),
    categoriesCovered: cats.filter((c) => c.correct > 0).length,
    maxCategoryCorrect: Math.max(0, ...cats.map((c) => c.correct)),
    modeWins: Object.fromEntries(modeWins.map((r) => [r.mode, r.wins])),
    teamWins: count(
      'SELECT COUNT(*) AS n FROM match_players WHERE user_id = ? AND team IS NOT NULL AND placement = 1 AND left_match = 0',
      userId,
    ),
    maxRating: Math.round(
      one<{ r: number | null }>('SELECT MAX(peak) AS r FROM season_ratings WHERE user_id = ?', userId)?.r ??
        START_RATING,
    ),
    dailyCompleted: count(
      'SELECT COUNT(*) AS n FROM daily_results WHERE user_id = ? AND finished_at IS NOT NULL',
      userId,
    ),
    bestDailyStreak: u.best_daily_streak,
    friends: count(
      "SELECT COUNT(*) AS n FROM friendships WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'",
      userId,
      userId,
    ),
    freezes: u.freezes,
    approvedQuestions: count('SELECT COUNT(*) AS n FROM questions WHERE author_id = ?', userId),
    bestSeasonTier: bestSeasonTier(userId),
  };
}

function isEarned(id: string, agg: Aggregate, match: MatchContext | null): boolean {
  const rule = RULES[id];
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  if (!rule || !def) return false;
  if (rule.earned) return rule.earned(agg, match);
  return def.goal !== undefined && rule.progress !== undefined && rule.progress(agg) >= def.goal;
}

/**
 * Unlocks everything the player now qualifies for and pays out its XP. Level achievements can cascade
 * (achievement XP → new level → level achievement), so it loops until nothing new unlocks.
 * Call inside a transaction, after the player's stats and XP for the triggering event are written.
 */
export function settleAchievements(userId: number, match: MatchContext | null): { ids: string[]; lines: XpLine[] } {
  const owned = new Set(
    all<{ achievement_id: string }>('SELECT achievement_id FROM user_achievements WHERE user_id = ?', userId).map(
      (r) => r.achievement_id,
    ),
  );
  const ids: string[] = [];
  const lines: XpLine[] = [];
  const agg = loadAggregate(userId);
  for (let changed = true; changed; ) {
    changed = false;
    agg.level = levelFromXp(getUser(userId)!.xp);
    for (const def of ACHIEVEMENTS) {
      if (owned.has(def.id) || !isEarned(def.id, agg, match)) continue;
      owned.add(def.id);
      ids.push(def.id);
      lines.push({ label: `Постижение: ${def.name}`, amount: def.xp });
      run(
        'INSERT INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)',
        userId,
        def.id,
        Date.now(),
      );
      run('UPDATE users SET xp = xp + ? WHERE id = ?', def.xp, userId);
      changed = true;
    }
  }
  return { ids, lines };
}

export function achievementProgress(userId: number): AchievementProgress[] {
  const agg = loadAggregate(userId);
  const unlocked = new Map(
    all<{ achievement_id: string; unlocked_at: number }>(
      'SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ?',
      userId,
    ).map((r) => [r.achievement_id, r.unlocked_at]),
  );
  return ACHIEVEMENTS.map((def) => {
    const raw = RULES[def.id]?.progress?.(agg);
    return {
      id: def.id,
      unlockedAt: unlocked.get(def.id) ?? null,
      progress: raw === undefined || def.goal === undefined ? null : Math.min(raw, def.goal),
    };
  });
}
