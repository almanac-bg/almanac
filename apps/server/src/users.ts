import { levelFromXp, type PublicUser } from '@quiz/shared';
import { all, one } from './db';

export interface UserRow {
  id: number;
  username: string;
  username_key: string;
  password_hash: string;
  created_at: number;
  xp: number;
  avatar: string;
  frame: string;
  title: string;
  last_daily_bonus: string | null;
  games_played: number;
  mp_games: number;
  wins: number;
  questions_answered: number;
  correct_answers: number;
  best_streak: number;
  fastest_correct_ms: number | null;
  total_correct_ms: number;
  powerups_used: number;
  best_solo_score: number;
  hosted_games: number;
  is_admin: number;
  daily_streak: number;
  best_daily_streak: number;
  last_daily_day: string | null;
  /** Verified address only; an unverified one waits in `pending_email`. */
  email: string | null;
  email_key: string | null;
  pending_email: string | null;
  /** When the mail provider reported the verified address as undeliverable; cleared when an address is verified. */
  email_bounced_at: number | null;
  banned_until: number | null;
  ban_reason: string | null;
  /** Created by "Играй като гост": no password until claimed with a name and password. */
  is_guest: number;
  /** Earned every 7 days of daily streak (at most 2); a missed day uses one up instead of breaking the streak. */
  streak_shields: number;
  /** Opted in to an evening email when the daily streak is about to break. */
  streak_reminders: number;
  /** Secret in the reminder email's unsubscribe link. */
  reminder_key: string | null;
  reminded_day: string | null;
  /** Last sign-in, or last time a session was extended (so within a couple of weeks of the last visit). */
  last_seen_at: number | null;
  /** When the "your account will be deleted" email went out; cleared by signing in. */
  inactivity_warned_at: number | null;
}

/** Names guests get ("Гост_482113"); nobody can register one. */
export const GUEST_NAME = /^(гост|gost|guest)[\s_.-]*\d*$/iu;

/** Shown in other players' match history once an account is deleted. */
export const DELETED_NAME = 'Изтрит играч';

export const getUser = (id: number) => one<UserRow>('SELECT * FROM users WHERE id = ?', id);
export const usernameKey = (username: string) => username.normalize('NFC').toLowerCase();
export const getUserByName = (username: string) =>
  one<UserRow>('SELECT * FROM users WHERE username_key = ?', usernameKey(username));

export const emailKey = (email: string) => email.trim().normalize('NFC').toLowerCase();
export const getUserByEmail = (email: string) =>
  one<UserRow>('SELECT * FROM users WHERE email_key = ?', emailKey(email));

/** Login accepts a username or a verified email. */
export const getUserByLogin = (login: string) => (login.includes('@') ? getUserByEmail(login) : getUserByName(login));

export function toPublicUser(row: Pick<UserRow, 'id' | 'username' | 'xp' | 'avatar' | 'frame' | 'title'>): PublicUser {
  return {
    id: row.id,
    username: row.username,
    xp: row.xp,
    level: levelFromXp(row.xp),
    avatar: row.avatar,
    frame: row.frame,
    title: row.title,
  };
}

export function publicUser(id: number): PublicUser | null {
  const row = getUser(id);
  return row ? toPublicUser(row) : null;
}

export function achievementSet(userId: number): Set<string> {
  const rows = all<{ achievement_id: string }>(
    'SELECT achievement_id FROM user_achievements WHERE user_id = ?',
    userId,
  );
  return new Set(rows.map((r) => r.achievement_id));
}

/** Moderators: the account flag, set with the admin command line (src/cli.ts) or for the first account in development. */
export function isAdmin(row: Pick<UserRow, 'is_admin'>): boolean {
  return row.is_admin === 1;
}
