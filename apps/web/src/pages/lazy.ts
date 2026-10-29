import { type ComponentType, createElement, lazy, useState } from 'react';

/**
 * Pages beyond the first screen load on demand, so visitors download the sign-in page or the lobby first.
 * Once the app is idle, `prefetchPages()` fetches the rest, so moving around (or a match popping) stays instant.
 */
const loaders = {
  account: () => import('./AccountPages'),
  achievements: () => import('./AchievementsPage'),
  almanac: () => import('./AlmanacPage'),
  admin: () => import('./AdminPage'),
  challenge: () => import('./ChallengePage'),
  daily: () => import('./DailyPage'),
  friends: () => import('./FriendsPage'),
  game: () => import('./GamePage'),
  groups: () => import('./GroupsPage'),
  leaderboard: () => import('./LeaderboardPage'),
  legal: () => import('./LegalPages'),
  guide: () => import('./GuidePages'),
  locker: () => import('./LockerPage'),
  notifications: () => import('./NotificationsPage'),
  profile: () => import('./ProfilePage'),
  room: () => import('./RoomPage'),
  sets: () => import('./SetsPage'),
  submit: () => import('./SubmitPage'),
  unsubscribe: () => import('./UnsubscribePage'),
};

type Loader = keyof typeof loaders;
type Module = Record<string, ComponentType>;

/** The modules that have arrived: a page from one of them renders at once, without a moment of "loading". */
const ready = new Map<Loader, Module>();

function load(loader: Loader): Promise<Module> {
  return loaders[loader]().then((mod) => {
    ready.set(loader, mod as unknown as Module);
    return mod as unknown as Module;
  });
}

/**
 * A page that's about to be shown didn't arrive. A tab opened before a deploy asks for files that are gone: one reload
 * gets the new version. Not while offline (that would only swap the app for the offline page), and not twice in a
 * row. Only for a page being shown: a background fetch that fails (prefetchPages) mustn't reload the app under the
 * player, taking whatever they were typing with it.
 */
export function reloadForNewVersion() {
  if (!navigator.onLine) return;
  try {
    if (Date.now() - Number(sessionStorage.getItem('quiz:reloadedAt') ?? 0) < 10_000) return; // already tried
    sessionStorage.setItem('quiz:reloadedAt', String(Date.now()));
  } catch {
    /* storage unavailable: reload anyway */
  }
  window.location.reload();
}

function page<L extends Loader>(loader: L, name: keyof Awaited<ReturnType<(typeof loaders)[L]>>) {
  const Lazy = lazy(() =>
    load(loader).then(
      (mod) => ({ default: mod[name as string] }),
      (err: unknown) => {
        reloadForNewVersion();
        throw err;
      },
    ),
  );
  // biome-ignore lint/correctness/noComponentHookFactories: made once per page when this module loads, never in a render, so each page's component stays the same
  function Page(props: object) {
    // Decided once per mount: a page whose code is here already renders at once (no "loading" in between, and a page
    // the server drew hydrates as it is); otherwise it loads. Never switched while mounted, which would remount it.
    const [Component] = useState<ComponentType>(() => ready.get(loader)?.[name as string] ?? Lazy);
    return createElement(Component, props);
  }
  return Page;
}

export const AchievementsPage = page('achievements', 'AchievementsPage');
export const AdminPage = page('admin', 'AdminPage');
export const AlmanacPage = page('almanac', 'AlmanacPage');
export const ChallengePage = page('challenge', 'ChallengePage');
export const DailyPage = page('daily', 'DailyPage');
export const FriendsPage = page('friends', 'FriendsPage');
export const GamePage = page('game', 'GamePage');
export const GroupsPage = page('groups', 'GroupsPage');
export const LeaderboardPage = page('leaderboard', 'LeaderboardPage');
export const LockerPage = page('locker', 'LockerPage');
export const NotificationsPage = page('notifications', 'NotificationsPage');
export const PrivacyPage = page('legal', 'PrivacyPage');
export const ProfilePage = page('profile', 'ProfilePage');
export const ResetPasswordPage = page('account', 'ResetPasswordPage');
export const RoomPage = page('room', 'RoomPage');
export const SettingsPage = page('account', 'SettingsPage');
export const SetsPage = page('sets', 'SetsPage');
export const SubmitPage = page('submit', 'SubmitPage');
export const TermsPage = page('legal', 'TermsPage');
export const HowToPlayPage = page('guide', 'HowToPlayPage');
export const QuizHubPage = page('guide', 'QuizHubPage');
export const QuizCategoryPage = page('guide', 'QuizCategoryPage');
export const FactsPage = page('guide', 'FactsPage');
export const TeachersPage = page('guide', 'TeachersPage');
export const UnsubscribePage = page('unsubscribe', 'UnsubscribePage');
export const VerifyEmailPage = page('account', 'VerifyEmailPage');

/** Rarely opened, or only by moderators: loaded when asked for, not in the background. */
const ON_REQUEST: Loader[] = ['legal', 'unsubscribe', 'admin'];

/** Warms the browser's module cache with the pages a player moves between (each loads once; later imports reuse it). */
export function prefetchPages({ admin }: { admin: boolean }) {
  for (const loader of Object.keys(loaders) as Loader[])
    if (!ON_REQUEST.includes(loader) || (admin && loader === 'admin')) void load(loader).catch(() => {});
}

/**
 * The code of the page at this address, when it loads on demand: fetched before the app first draws it, so a page
 * the server sent drawn never blinks to "loading" (main.tsx). Only the legal pages are both.
 */
export function preloadPage(pathname: string): Promise<unknown> {
  return pathname === '/privacy' || pathname === '/terms' ? load('legal') : Promise.resolve();
}
