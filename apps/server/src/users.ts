import { levelFromXp, type PublicUser } from '@quiz/shared';
import { config } from './config';
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
}

export const getUser = (id: number) => one<UserRow>('SELECT * FROM users WHERE id = ?', id);
export const usernameKey = (username: string) => username.normalize('NFC').toLowerCase();
export const getUserByName = (username: string) =>
  one<UserRow>('SELECT * FROM users WHERE username_key = ?', usernameKey(username));

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

export function isAdmin(row: Pick<UserRow, 'is_admin' | 'username_key'>): boolean {
  return row.is_admin === 1 || config.adminUsernames.includes(row.username_key);
}
