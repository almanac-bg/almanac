import { publicPageCode, routeKind } from '@almanac/shared';
import { type ComponentType, createElement, lazy, useState } from 'react';
import { matchPath } from 'react-router';
import { loadQuiz } from '../content/quizzes';
import { holdForReload, reloadForNewVersion } from '../lib/reload';

/**
 * Pages beyond the first screen load on demand, so visitors download the sign-in page or the lobby first.
 * Once the app is idle, `prefetchPages()` fetches the rest, so moving around (or a match popping) stays instant.
 */
const loaders = {
  account: () => import('./AccountPages'),
  // The landing's sign-in and the lobby: each in a file of its own, so a visitor downloads only the one they see.
  auth: () => import('./AuthPage'),
  home: () => import('./HomePage'),
  // The signed-in app around the pages (header, tab bar, invites, the queue, the prompts): with the lobby, never on the
  // landing.
  frame: () => import('../SignedIn'),
  // Someone's link opened signed out (their day's questions, their challenge): the landing with that player.
  invitation: () => import('../components/landing/Invitation'),
  achievements: () => import('./AchievementsPage'),
  knowledge: () => import('./KnowledgePage'),
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
type Exports<L extends Loader> = Awaited<ReturnType<(typeof loaders)[L]>>;
type PropsOf<T> = T extends ComponentType<infer P> ? P : never;
/** A page (or a piece of one) that loads on demand, and which file it's in. */
type LazyPage<P = object> = ComponentType<P> & { loader: Loader };

/** The modules that have arrived: a page from one of them renders at once, without a moment of "loading". */
const ready = new Map<Loader, Module>();

function load(loader: Loader): Promise<Module> {
  return loaders[loader]().then((mod) => {
    ready.set(loader, mod as unknown as Module);
    return mod as unknown as Module;
  });
}

/** Pages whose code didn't arrive: asked for anew only when the player says to (retryFailedPages). */
const failed = new Set<() => void>();

/**
 * „Опитай пак“ on a page whose code didn't arrive: its next mount imports the file anew. (A failed import stays failed
 * in the component React made for it; and a new one on every render would ask again in a loop, since a page that
 * suspends while it first mounts is rendered from scratch each time.)
 */
export function retryFailedPages() {
  for (const forget of failed) forget();
  failed.clear();
}

function page<L extends Loader, N extends keyof Exports<L> & string>(
  loader: L,
  name: N,
): LazyPage<PropsOf<Exports<L>[N]>> {
  let Lazy: ComponentType | null = null;
  const loading = () =>
    (Lazy ??= lazy(() =>
      load(loader).then(
        (mod) => ({ default: mod[name] }),
        (err: unknown) => {
          failed.add(() => {
            Lazy = null;
          });
          if (reloadForNewVersion()) return holdForReload();
          throw err;
        },
      ),
    ));
  // biome-ignore lint/correctness/noComponentHookFactories: made once per page when this module loads, never in a render, so each page's component stays the same
  function Page(props: PropsOf<Exports<L>[N]>) {
    // Decided once per mount: a page whose code is here already renders at once (no "loading" in between, and a page
    // the server drew hydrates as it is); otherwise it loads. Never switched while mounted, which would remount it.
    const [Component] = useState<ComponentType>(() => ready.get(loader)?.[name] ?? loading());
    return createElement(Component, props as object);
  }
  return Object.assign(Page, { loader });
}

export const SignedIn = page('frame', 'SignedIn');
export const ChallengeLanding = page('invitation', 'ChallengeLanding');
export const DailyLanding = page('invitation', 'DailyLanding');
export const AchievementsPage = page('achievements', 'AchievementsPage');
export const AuthPage = page('auth', 'AuthPage');
export const HomePage = page('home', 'HomePage');
export const AdminPage = page('admin', 'AdminPage');
export const KnowledgePage = page('knowledge', 'KnowledgePage');
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
export const ClassPage = page('room', 'ClassPage');
export const SettingsPage = page('account', 'SettingsPage');
export const SetsPage = page('sets', 'SetsPage');
export const SubmitPage = page('submit', 'SubmitPage');
export const TermsPage = page('legal', 'TermsPage');
export const DeleteAccountPage = page('legal', 'DeleteAccountPage');
export const HowToPlayPage = page('guide', 'HowToPlayPage');
export const QuizHubPage = page('guide', 'QuizHubPage');
export const QuizCategoryPage = page('guide', 'QuizCategoryPage');
export const FactsPage = page('guide', 'FactsPage');
export const TeachersPage = page('guide', 'TeachersPage');
export const UnsubscribePage = page('unsubscribe', 'UnsubscribePage');
export const VerifyEmailPage = page('account', 'VerifyEmailPage');

/**
 * The signed-in app's pages by address: SignedIn routes them, and a cold start on one fetches its code beside /api/me
 * (prefetchStart). The invite links (/join/<code>) are SignedIn's own.
 */
export const APP_PAGES: [path: string, page: LazyPage][] = [
  ['/', HomePage],
  ['/game', GamePage],
  ['/room', RoomPage],
  ['/class', ClassPage],
  ['/c/:id', ChallengePage],
  ['/daily', DailyPage],
  ['/daily/:code', DailyPage],
  ['/profile', ProfilePage],
  ['/profile/:username', ProfilePage],
  ['/achievements', AchievementsPage],
  ['/locker', LockerPage],
  ['/notifications', NotificationsPage],
  ['/leaderboard', LeaderboardPage],
  ['/friends', FriendsPage],
  ['/knowledge', KnowledgePage],
  ['/knowledge/:category', KnowledgePage],
  ['/groups', GroupsPage],
  ['/groups/:id', GroupsPage],
  ['/groups/join/:code', GroupsPage],
  ['/sets', SetsPage],
  ['/sets/:id', SetsPage],
  ['/sets/shared/:code', SetsPage],
  ['/submit', SubmitPage],
  ['/admin', AdminPage],
  ['/settings', SettingsPage],
];

/**
 * Not in the background: rarely opened (the legal pages, an email's unsubscribe link), only by moderators, or not by
 * a signed-in player (the guides and the sign-in, which a player almost never opens).
 */
const ON_REQUEST: Loader[] = ['legal', 'unsubscribe', 'admin', 'guide', 'auth', 'invitation'];

/** A line the player pays for or waits on (Save-Data, or 2G): nothing fetched on the off chance. */
function sparing(): boolean {
  const line = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!line && (line.saveData === true || /2g/.test(line.effectiveType ?? ''));
}

/**
 * Warms the browser's module cache with the pages a player moves between (each loads once; later imports reuse it).
 * The match first: a queue that pops or a room that starts can't wait for its page. On a sparing line, only the match.
 */
export function prefetchPages({ admin }: { admin: boolean }) {
  const wanted = (Object.keys(loaders) as Loader[]).filter(
    (loader) => loader !== 'game' && (!ON_REQUEST.includes(loader) || (admin && loader === 'admin')),
  );
  for (const loader of sparing() ? ['game' as const] : ['game' as const, ...wanted]) void load(loader).catch(() => {});
}

/**
 * The code a public page needs before the app first draws it (main.tsx): its page file and the quiz it shows (a
 * holiday's own questions, or the public sample), so a page the server drew hydrates as it is, without a blink to
 * "loading". The landing's sign-in only for a visitor without a session (`signedOut`): with one, the lobby comes.
 */
export function preloadPage(pathname: string, signedOut: boolean): Promise<unknown> {
  const code = publicPageCode(pathname);
  if (!code || (code.page === 'auth' && !signedOut)) return Promise.resolve();
  return Promise.all([load(code.page), code.quiz && loadQuiz(code.quiz)]);
}

/**
 * The signed-in app at this address: its frame and the page (an invite link leads to its room). Asked for the moment a
 * session is on its way (signing in, a guest's start), or as a page with one starts (prefetchStart).
 */
export function prefetchApp(pathname: string) {
  const page = APP_PAGES.find(([path]) => matchPath(path, pathname))?.[1];
  const loader = page?.loader ?? (pathname.startsWith('/join/') ? 'room' : null);
  for (const l of ['frame', loader] as const) if (l) void load(l).catch(() => {});
}

/**
 * A start on a page the server didn't draw: what it will show is fetched as the page starts, beside /api/me rather than
 * after it — the sign-in for a visitor the server knows has no session (with the player whose link it is, for a
 * challenge or the day's questions), otherwise the signed-in app at this address.
 */
export function prefetchStart(pathname: string, signedOut: boolean) {
  if (routeKind(pathname) !== 'app' && pathname !== '/') return; // a public page: preloadPage's
  if (!signedOut) return prefetchApp(pathname);
  const invited = /^\/(c|daily)(\/|$)/.test(pathname);
  for (const l of ['auth', invited && 'invitation'] as const) if (l) void load(l).catch(() => {});
}
