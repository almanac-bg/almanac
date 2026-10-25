import { type ComponentType, lazy } from 'react';

/**
 * Pages beyond the first screen load on demand, so visitors download the sign-in page or the lobby first.
 * Once the app is idle, `prefetchPages()` fetches the rest, so moving around (or a match popping) stays instant.
 */
const loaders = {
  account: () => import('./AccountPages'),
  achievements: () => import('./AchievementsPage'),
  admin: () => import('./AdminPage'),
  challenge: () => import('./ChallengePage'),
  friends: () => import('./FriendsPage'),
  game: () => import('./GamePage'),
  leaderboard: () => import('./LeaderboardPage'),
  legal: () => import('./LegalPages'),
  locker: () => import('./LockerPage'),
  profile: () => import('./ProfilePage'),
  room: () => import('./RoomPage'),
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

function page<L extends Loader>(loader: L, name: keyof Awaited<ReturnType<(typeof loaders)[L]>>) {
  const pick = (mod: Module) => ({ default: mod[name as string] });
  return lazy(() => {
    const mod = ready.get(loader);
    // A thenable that settles on the spot: React then renders the page straight away instead of suspending.
    // biome-ignore lint/suspicious/noThenProperty: that thenable is the point
    if (mod) return { then: (resolve: (m: { default: ComponentType }) => void) => resolve(pick(mod)) } as never;
    return load(loader).then(pick);
  });
}

export const AchievementsPage = page('achievements', 'AchievementsPage');
export const AdminPage = page('admin', 'AdminPage');
export const ChallengePage = page('challenge', 'ChallengePage');
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
export const UnsubscribePage = page('unsubscribe', 'UnsubscribePage');
export const VerifyEmailPage = page('account', 'VerifyEmailPage');

/** Warms the browser's module cache with every page (each loads once; later imports reuse it). */
export function prefetchPages() {
  for (const loader of Object.keys(loaders) as Loader[]) void load(loader).catch(() => {});
}

/**
 * The code of the page at this address, when it loads on demand: fetched before the app first draws it, so a page
 * the server sent drawn never blinks to "loading" (main.tsx). Only the legal pages are both.
 */
export function preloadPage(pathname: string): Promise<unknown> {
  return pathname === '/privacy' || pathname === '/terms' ? load('legal') : Promise.resolve();
}
