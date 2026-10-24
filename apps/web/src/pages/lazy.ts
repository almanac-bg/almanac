import { type ComponentType, lazy } from 'react';

/**
 * Pages beyond the first screen load on demand, so visitors download the sign-in page or the lobby first.
 * Once the app is idle, `prefetchPages()` fetches the rest, so moving around (or a match popping) stays instant.
 */
const loaders = {
  account: () => import('./AccountPages'),
  achievements: () => import('./AchievementsPage'),
  admin: () => import('./AdminPage'),
  friends: () => import('./FriendsPage'),
  game: () => import('./GamePage'),
  leaderboard: () => import('./LeaderboardPage'),
  legal: () => import('./LegalPages'),
  locker: () => import('./LockerPage'),
  profile: () => import('./ProfilePage'),
  room: () => import('./RoomPage'),
  submit: () => import('./SubmitPage'),
};

type Loader = keyof typeof loaders;

function page<L extends Loader>(loader: L, name: keyof Awaited<ReturnType<(typeof loaders)[L]>>) {
  return lazy(async () => {
    const mod = (await loaders[loader]()) as unknown as Record<string, ComponentType>;
    return { default: mod[name as string] };
  });
}

export const AchievementsPage = page('achievements', 'AchievementsPage');
export const AdminPage = page('admin', 'AdminPage');
export const FriendsPage = page('friends', 'FriendsPage');
export const GamePage = page('game', 'GamePage');
export const LeaderboardPage = page('leaderboard', 'LeaderboardPage');
export const LockerPage = page('locker', 'LockerPage');
export const PrivacyPage = page('legal', 'PrivacyPage');
export const ProfilePage = page('profile', 'ProfilePage');
export const ResetPasswordPage = page('account', 'ResetPasswordPage');
export const RoomPage = page('room', 'RoomPage');
export const SettingsPage = page('account', 'SettingsPage');
export const SubmitPage = page('submit', 'SubmitPage');
export const TermsPage = page('legal', 'TermsPage');
export const VerifyEmailPage = page('account', 'VerifyEmailPage');

/** Warms the browser's module cache with every page (each loads once; later imports reuse it). */
export function prefetchPages() {
  for (const load of Object.values(loaders)) void load().catch(() => {});
}
