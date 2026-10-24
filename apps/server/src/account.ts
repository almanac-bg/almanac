import { dayKey, isUnlocked, levelFromXp, type Loadout, type MeUser, newlyUnlocked, type UnlockContext } from '@quiz/shared';
import { settleAchievements } from './achievements';
import { verifyPassword } from './auth';
import { liveDailyStreak } from './daily';
import { all, one, run, tx } from './db';
import { incomingRequests } from './friends';
import { disconnectUser, notifyUser, removeFromPlay } from './notify';
import { bestSeasonTier, getRatings, settleSeasons, unseenSeasonRewards } from './seasons';
import { achievementSet, DELETED_NAME, getUser, isAdmin, toPublicUser } from './users';

export function unlockContext(userId: number): UnlockContext {
  return {
    level: levelFromXp(getUser(userId)!.xp),
    achievements: achievementSet(userId),
    seasonTier: bestSeasonTier(userId),
  };
}

/**
 * Pays out anything earned outside a match: finished seasons and achievements whose progress moved
 * (friends, approved questions…). Cheap when there's nothing to do, so it runs on every /me.
 */
export function settleAccount(userId: number) {
  const unlocked = tx(() => {
    settleSeasons(
      userId,
      (tier) => {
        const before = unlockContext(userId);
        return newlyUnlocked(before, { ...before, seasonTier: Math.max(before.seasonTier, tier) });
      },
      (xp) => run('UPDATE users SET xp = xp + ? WHERE id = ?', xp, userId),
    );
    return settleAchievements(userId, null).ids;
  });
  if (unlocked.length) notifyUser(userId, 'achievements', unlocked);
}

/** Grants XP for something done outside a match, then settles achievements it may have unlocked. */
export function grantXp(userId: number, xp: number) {
  run('UPDATE users SET xp = xp + ? WHERE id = ?', xp, userId);
  settleAccount(userId);
}

export function getMe(userId: number): MeUser | null {
  if (!getUser(userId)) return null;
  settleAccount(userId);
  const row = getUser(userId)!;
  const today = dayKey();
  return {
    ...toPublicUser(row),
    createdAt: row.created_at,
    achievements: [...achievementSet(userId)],
    ratings: getRatings(userId),
    dailyBonusAvailable: row.last_daily_bonus !== today,
    isAdmin: isAdmin(row),
    bestSeasonTier: bestSeasonTier(userId),
    daily: {
      day: today,
      played: !!one('SELECT 1 AS x FROM daily_results WHERE user_id = ? AND day = ?', userId, today),
      streak: liveDailyStreak(row),
    },
    seasonRewards: unseenSeasonRewards(userId),
    friendRequests: incomingRequests(userId),
    email: row.email,
    pendingEmail: row.pending_email,
  };
}

export function updateLoadout(userId: number, patch: Partial<Loadout>): { ok: true } | { ok: false; error: string } {
  const row = getUser(userId);
  if (!row) return { ok: false, error: 'Няма такъв потребител.' };
  const ctx = unlockContext(userId);
  const next = { avatar: row.avatar, frame: row.frame, title: row.title };
  for (const kind of ['avatar', 'frame', 'title'] as const) {
    const value = patch[kind];
    if (value === undefined) continue;
    if (!isUnlocked(kind, value, ctx)) return { ok: false, error: 'Този предмет още е заключен.' };
    next[kind] = value;
  }
  run('UPDATE users SET avatar = ?, frame = ?, title = ? WHERE id = ?', next.avatar, next.frame, next.title, userId);
  return { ok: true };
}

// ─── GDPR: export and erasure ────────────────────────────────────────────────

/** Everything stored about the player, as a downloadable JSON document. */
export function exportAccount(userId: number) {
  const u = getUser(userId)!;
  const rows = <T>(sql: string) => all<T>(sql, userId);
  return {
    exportedAt: new Date().toISOString(),
    account: {
      username: u.username,
      createdAt: new Date(u.created_at).toISOString(),
      email: u.email,
      pendingEmail: u.pending_email,
      xp: u.xp,
      level: levelFromXp(u.xp),
      loadout: { avatar: u.avatar, frame: u.frame, title: u.title },
      stats: {
        gamesPlayed: u.games_played,
        multiplayerGames: u.mp_games,
        wins: u.wins,
        questionsAnswered: u.questions_answered,
        correctAnswers: u.correct_answers,
        bestStreak: u.best_streak,
        fastestCorrectMs: u.fastest_correct_ms,
        bestSoloScore: u.best_solo_score,
        powerupsUsed: u.powerups_used,
        dailyStreak: u.daily_streak,
        bestDailyStreak: u.best_daily_streak,
      },
    },
    achievements: rows('SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ?'),
    categoryStats: rows('SELECT category, answered, correct FROM category_stats WHERE user_id = ?'),
    seasonRatings: rows('SELECT season, mode, rating, peak, games, wins FROM season_ratings WHERE user_id = ?'),
    seasonRewards: rows('SELECT season, tier, xp, granted_at FROM season_rewards WHERE user_id = ?'),
    dailyResults: rows('SELECT day, score, correct, finished_at FROM daily_results WHERE user_id = ?'),
    matches: rows(
      `SELECT m.mode, m.ranked, m.ended_at, mp.placement, mp.score, mp.correct, mp.xp_gained, mp.rating_delta
       FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.user_id = ? ORDER BY m.ended_at`,
    ),
    friends: all(
      `SELECT u.username, f.status, f.created_at FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
       WHERE f.user_a = ? OR f.user_b = ?`,
      userId,
      userId,
      userId,
    ),
    questionSubmissions: rows('SELECT category, difficulty, q, options, answer, status, reason, created_at FROM question_submissions WHERE user_id = ?'),
    reportsFiled: rows('SELECT reason, details, status, created_at FROM reports WHERE reporter_id = ?'),
    questionReportsFiled: rows('SELECT question_id, reason, details, status, created_at FROM question_reports WHERE user_id = ?'),
  };
}

/**
 * Deletes the account and everything tied to it (the schema cascades). Other players' match histories keep
 * the result row, but without the name. Approved questions stay in the game, without author credit.
 */
export async function deleteAccount(userId: number, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = getUser(userId);
  if (!user) return { ok: false, error: 'Няма такъв потребител.' };
  if (!(await verifyPassword(password, user.password_hash))) return { ok: false, error: 'Грешна парола.' };
  removeFromPlay(userId);
  tx(() => {
    run('UPDATE match_players SET user_id = NULL, name = ? WHERE user_id = ?', DELETED_NAME, userId);
    run('DELETE FROM users WHERE id = ?', userId);
  });
  disconnectUser(userId);
  return { ok: true };
}
