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
  freezes: number;
  /** Verified address only; an unverified one waits in `pending_email`. */
  email: string | null;
  email_key: string | null;
  pending_email: string | null;
  banned_until: number | null;
  ban_reason: string | null;
}

/** Shown in other players' match history once an account is deleted. */
export const DELETED_NAME = 'Изтрит играч';

export const getUser = (id: number) => one<UserRow>('SELECT * FROM users WHERE id = ?', id);
export const usernameKey = (username: string) => username.normalize('NFC').toLowerCase();
export const getUserByName = (username: string) =>
  one<UserRow>('SELECT * FROM users WHERE username_key = ?', usernameKey(username));

export const emailKey = (email: string) => email.trim().normalize('NFC').toLowerCase();
export const getUserByEmail = (email: string) => one<UserRow>('SELECT * FROM users WHERE email_key = ?', emailKey(email));

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
  const rows = all<{ achievement_id: string }>('SELECT achievement_id FROM user_achievements WHERE user_id = ?', userId);
  return new Set(rows.map((r) => r.achievement_id));
}

/** Moderators: the account flag, set with the admin command line (src/cli.ts) or for the first account in development. */
export function isAdmin(row: Pick<UserRow, 'is_admin'>): boolean {
  return row.is_admin === 1;
}
