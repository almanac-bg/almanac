import { dayKey, isUnlocked, levelFromXp, type Loadout, type MeUser, newlyUnlocked, type UnlockContext } from '@quiz/shared';
import { settleAchievements } from './achievements';
import { liveDailyStreak } from './daily';
import { one, run, tx } from './db';
import { incomingRequests } from './friends';
import { notifyUser } from './notify';
import { bestSeasonTier, getRatings, settleSeasons, unseenSeasonRewards } from './seasons';
import { achievementSet, getUser, isAdmin, toPublicUser } from './users';

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
