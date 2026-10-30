import { createHash } from 'node:crypto';
import {
  ACHIEVEMENTS,
  dayKey,
  isUnlocked,
  type Loadout,
  levelFromXp,
  type MeUser,
  newlyUnlocked,
  seasonKey,
  setPictureUrl,
  type UnlockContext,
} from '@quiz/shared';
import { settleAchievements } from './achievements';
import { factCount, reviewQueue } from './almanac';
import { verifyPassword } from './auth';
import { config } from './config';
import { liveDailyStreak } from './daily';
import { all, one, run, tx } from './db';
import { isChampion } from './evening';
import { incomingRequests } from './friends';
import { dropEmptyGroups, groupIdsOf } from './groups';
import { earnedMastery } from './mastery';
import { unreadNotifications } from './notifications';
import { disconnectUser, notifyUser, removeFromPlay } from './notify';
import { pushPrefs } from './push';
import { reloadQuestionBank } from './questions';
import { questsInfo } from './quests';
import { bestSeasonTier, getRatings, settleSeasons, unseenSeasonRewards } from './seasons';
import { achievementSet, DELETED_NAME, getUser, isAdmin, toPublicUser, type UserRow } from './users';

export function unlockContext(userId: number): UnlockContext {
  return {
    level: levelFromXp(getUser(userId)!.xp),
    achievements: achievementSet(userId),
    seasonTier: bestSeasonTier(userId),
    mastery: Object.fromEntries(earnedMastery(userId).map((m) => [m.category, m.tier])),
    eveningChampion: isChampion(userId),
  };
}

/**
 * Pays out anything earned outside a match: finished seasons and achievements whose progress moved (friends, approved
 * questions, XP from a friend duel or a recording…). What moves it calls this; /me only when settleIfDue says so.
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

/**
 * What an account is settled for: the season (one that ended pays out) and the achievements there are, with their
 * goals (a new one may already be earned). Everything else that unlocks something settles as it happens.
 */
const ACHIEVEMENT_LIST = createHash('sha256')
  .update(ACHIEVEMENTS.map((a) => `${a.id}:${a.goal ?? ''}`).join())
  .digest('base64url')
  .slice(0, 12);

/** Settles the account when the season or the list of achievements changed since it last was: not on every /me. */
function settleIfDue(row: UserRow) {
  const due = `${seasonKey()} ${ACHIEVEMENT_LIST}`;
  if (row.settled === due) return;
  settleAccount(row.id);
  run('UPDATE users SET settled = ? WHERE id = ?', due, row.id);
}

export function getMe(userId: number): MeUser | null {
  const before = getUser(userId);
  if (!before) return null;
  settleIfDue(before);
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
    stats: {
      games: row.games_played,
      wins: row.wins,
      answered: row.questions_answered,
      correct: row.correct_answers,
    },
    daily: {
      day: today,
      played: !!one('SELECT 1 AS x FROM daily_results WHERE user_id = ? AND day = ?', userId, today),
      streak: liveDailyStreak(row),
      shields: row.streak_shields,
    },
    quests: questsInfo(userId, today),
    isGuest: row.is_guest === 1,
    roomGuest: row.room_guest_seen_at !== null,
    streakReminders: row.streak_reminders === 1,
    beatenMails: row.beaten_mails === 1,
    push: pushPrefs(row),
    shareRuns: row.share_runs === 1,
    seasonRewards: unseenSeasonRewards(userId),
    friendRequests: incomingRequests(userId),
    unreadNotifications: unreadNotifications(userId),
    email: row.email,
    emailBounced: row.email_bounced_at !== null,
    pendingEmail: row.pending_email,
    mastery: earnedMastery(userId).map((m) => ({ ...m })),
    almanac: { facts: factCount(userId), due: reviewQueue(userId).due },
    groups: groupIdsOf(userId).length,
    eveningChampion: isChampion(userId),
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

/**
 * Everything stored about the player, as a downloadable JSON document: whole rows, so it stays complete as the schema
 * grows. Left out are only secrets (password and token hashes) and other players' identities (who reported you).
 */
export function exportAccount(userId: number) {
  const {
    password_hash: _secret,
    username_key: _derived,
    username_shape: _shape,
    email_key: _alsoDerived,
    reminder_key: _link,
    ...account
  } = getUser(userId)!;
  const rows = (sql: string) => all<Record<string, unknown>>(sql, userId);
  return {
    exportedAt: new Date().toISOString(),
    account: { ...account, level: levelFromXp(account.xp), createdAt: new Date(account.created_at).toISOString() },
    achievements: rows('SELECT * FROM user_achievements WHERE user_id = ?'),
    categoryStats: rows('SELECT * FROM category_stats WHERE user_id = ?'),
    seasonRatings: rows('SELECT * FROM season_ratings WHERE user_id = ?'),
    seasonRewards: rows('SELECT * FROM season_rewards WHERE user_id = ?'),
    dailyResults: rows('SELECT * FROM daily_results WHERE user_id = ?'),
    dailyLinks: rows('SELECT code, day, created_at FROM daily_links WHERE user_id = ?'),
    // Each finished match question by question (the options as the bank orders them), and the skill measured from them.
    runs: rows(
      'SELECT match_id, mode, category, rating, score, correct, answers, played_at FROM runs WHERE user_id = ?',
    ).map((r) => ({ ...r, answers: JSON.parse(String(r.answers)) })),
    skill: rows('SELECT category, rating, answers FROM player_skill WHERE user_id = ?'),
    // „Моят алманах“ (questions got right, or stopped on to read), „Поправителен“, category mastery.
    learned: rows('SELECT question_id, learned_at FROM learned WHERE user_id = ? ORDER BY learned_at'),
    reviewQueue: rows('SELECT question_id, step, due_at FROM review_queue WHERE user_id = ? ORDER BY due_at'),
    mastery: rows('SELECT category, tier, earned_at FROM mastery WHERE user_id = ?'),
    eveningResults: rows('SELECT day, placement, score, players FROM evening_results WHERE user_id = ? ORDER BY day'),
    groups: rows(
      `SELECT g.name, g.owner_id = m.user_id AS owner, m.joined_at FROM group_members m
       JOIN player_groups g ON g.id = m.group_id WHERE m.user_id = ?`,
    ),
    questionSets: rows(
      'SELECT name, code, questions, hidden, created_at, updated_at FROM question_sets WHERE owner_id = ?',
    ).map((r) => ({ ...r, questions: JSON.parse(String(r.questions)) })),
    // The pictures themselves are at their address (too big to put in here).
    setPictures: rows('SELECT id, type, w, h, blocked, created_at FROM set_images WHERE owner_id = ?').map((r) => ({
      ...r,
      url: `${config.appUrl}${setPictureUrl(String(r.id))}`,
    })),
    groupWeeksWon: rows(
      `SELECT g.name, w.week, w.score FROM group_weeks w JOIN player_groups g ON g.id = w.group_id
       WHERE w.winner_id = ?`,
    ),
    dailyQuests: rows('SELECT day, quest, progress, done_at FROM quest_progress WHERE user_id = ? ORDER BY day'),
    challengesCreated: rows('SELECT id, rival_id, created_at, expires_at FROM challenges WHERE creator_id = ?'),
    // Friend duels others started with this player.
    duelsReceived: rows('SELECT id, creator_id, created_at, expires_at FROM challenges WHERE rival_id = ?'),
    // Matches others played against recordings of this player's matches (kept until a month after they were told).
    recordingsPlayed: rows('SELECT run_id, record_won, played_at FROM record_plays WHERE owner_id = ?'),
    challengeResults: rows('SELECT * FROM challenge_results WHERE user_id = ?'),
    answers: rows(
      `SELECT match_id, question_id, difficulty, correct, time_ms, answered_at FROM answers WHERE user_id = ?
       ORDER BY answered_at`,
    ),
    notifications: rows(
      'SELECT icon, text, link, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id',
    ),
    matches: rows(
      `SELECT m.mode, m.ranked, m.room_code, m.player_count, m.question_count, m.started_at, m.ended_at, mp.*
       FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.user_id = ? ORDER BY m.ended_at`,
    ),
    friends: all(
      `SELECT u.username, f.status, f.requested_by = ? AS you_asked, f.created_at, f.accepted_at FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
       WHERE f.user_a = ? OR f.user_b = ?`,
      userId,
      userId,
      userId,
      userId,
    ),
    questionSubmissions: rows('SELECT * FROM question_submissions WHERE user_id = ?'),
    reportsFiled: rows('SELECT * FROM reports WHERE reporter_id = ?'),
    reportsAboutYou: rows('SELECT reason, status, action, created_at, resolved_at FROM reports WHERE target_id = ?'),
    pushDevices: rows('SELECT created_at FROM push_subscriptions WHERE user_id = ?'),
    blocked: rows(
      'SELECT u.username, b.created_at FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ?',
    ),
    // Decisions about them, with their grounds (not which moderator took them).
    moderationDecisions: rows(
      'SELECT action, basis, reason, created_at, undone_at FROM moderation_log WHERE target_user_id = ? ORDER BY id',
    ),
    questionReportsFiled: rows('SELECT * FROM question_reports WHERE user_id = ?'),
    recentlySeenQuestions: rows(
      'SELECT question_id, seen_at FROM seen_questions WHERE user_id = ? ORDER BY seen_at DESC',
    ),
    loginSessions: rows('SELECT created_at, expires_at FROM sessions WHERE user_id = ?'),
    emailLinks: rows('SELECT purpose, email, created_at, expires_at, used_at FROM email_tokens WHERE user_id = ?'),
  };
}

/**
 * Deletes the account and everything tied to it (the schema cascades). Other players' match histories keep
 * the result row, but without the name. Approved questions stay in the game, without author credit.
 */
export async function deleteAccount(
  userId: number,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = getUser(userId);
  if (!user) return { ok: false, error: 'Няма такъв потребител.' };
  // A guest has no password: being signed in on this device is the proof.
  if (!user.is_guest && !(await verifyPassword(password, user.password_hash)))
    return { ok: false, error: 'Грешна парола.' };
  const authored = one('SELECT 1 AS x FROM questions WHERE author_id = ? LIMIT 1', userId);
  eraseAccount(userId);
  if (authored) reloadQuestionBank(); // their approved questions stop showing their name
  return { ok: true };
}

/** Removes an account for good (see deleteAccount); also used for guest accounts nobody can sign in to any more. */
export function eraseAccount(userId: number) {
  removeFromPlay(userId);
  tx(() => {
    const groups = groupIdsOf(userId);
    run('UPDATE match_players SET user_id = NULL, name = ? WHERE user_id = ?', DELETED_NAME, userId);
    // Reports they filed stay for the record, but their words go with them.
    run('UPDATE reports SET details = NULL WHERE reporter_id = ?', userId);
    // Decisions about them name them (an old name, a reason): they go too. A moderator's own stay, unsigned.
    run('DELETE FROM moderation_log WHERE target_user_id = ?', userId);
    run('DELETE FROM users WHERE id = ?', userId);
    // A group they were the last in goes with them.
    dropEmptyGroups(groups);
  });
  disconnectUser(userId);
}
