import { ApiError, api, getState, setState, useStore } from '@almanac/client';
import { routeKind } from '@almanac/shared';
import { LazyMotion, MotionConfig } from 'motion/react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { Background } from './components/Background';
import { PageBoundary } from './components/ErrorBoundary';
import { ReloadForUpdate } from './components/ReloadForUpdate';
import { SkipLink } from './components/SkipLink';
import { Toasts } from './components/Toasts';
import { Button, PageSpinner, Spinner } from './components/ui';
import { identify } from './lib/monitoring';
import { onServer, paintedSignedOut, paintingDone } from './lib/painted';
import { holdForReload, reloadForNewVersion } from './lib/reload';
import { markReturning } from './lib/returning';
import { useRouteFocus } from './lib/routeFocus';
import {
  AuthPage,
  DeleteAccountPage,
  FactsPage,
  HowToPlayPage,
  PrivacyPage,
  prefetchPages,
  QuizCategoryPage,
  QuizHubPage,
  ResetPasswordPage,
  SignedIn,
  TeachersPage,
  TermsPage,
  UnsubscribePage,
  VerifyEmailPage,
} from './pages/lazy';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * The connection's own code (packages/client/src/realtime.ts), fetched once someone is signed in: the landing never
 * needs it. One promise for every caller, so a connect and the disconnect after it run in the order they were asked.
 */
let realtimeCode: Promise<typeof import('@almanac/client/realtime')> | null = null;
const realtime = () =>
  (realtimeCode ??= import('@almanac/client/realtime').catch((err: unknown) => {
    realtimeCode = null; // to be asked for again
    throw err;
  }));

/** Email links and legal pages work whether or not you're signed in. */
const PUBLIC_PATHS = [
  '/reset-password',
  '/verify-email',
  '/unsubscribe',
  '/privacy',
  '/terms',
  '/delete-account',
  '/how-to-play',
  '/quiz',
  '/facts',
  '/teachers',
];
/** Pages that look the same signed in or out (the legal ones, the guides): outside the game's frame. */
const isPublicPath = (path: string) => PUBLIC_PATHS.includes(path) || /^\/quiz\/[a-z]+(-[a-z]+)*$/.test(path);
/**
 * …and the public pages the server draws (the legal ones, the guides) don't even ask: they read the same either way, so
 * the first draw here must be the page itself, as the server drew it, or hydrating it fails.
 */
const drawnForEveryone = (path: string) => path !== '/' && routeKind(path) === 'public';

// Needed, not extra: without them the light components stay as they start (some of them invisible). A file that
// didn't arrive is most likely an older build's after a deploy: one reload gets the new one.
const loadMotion = () =>
  import('./lib/motionFeatures').then(
    (r) => r.default,
    (err: unknown) => {
      if (reloadForNewVersion()) return holdForReload();
      throw err;
    },
  );

export function App() {
  const me = useStore((s) => s.me);
  const authChecked = useStore((s) => s.authChecked);
  const { pathname } = useLocation();
  useRouteFocus();

  // A new page — or the lobby right after signing in — starts at the top, not at the old scroll offset.
  const signedIn = !!me;
  // A guest has no name or password to sign in with, so the sign-in page shouldn't open on "Вход" for them.
  const account = signedIn && !me.isGuest;
  // Not on the first render: that page opens where the browser puts it (a page the server drew may be scrolled already).
  const opened = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` and `signedIn` are the triggers, not inputs
  useEffect(() => {
    if (opened.current) window.scrollTo(0, 0);
    opened.current = true;
  }, [pathname, signedIn]);
  useEffect(() => {
    // This device has an account now: next time the sign-in page opens on "Вход".
    if (account) markReturning();
  }, [account]);

  // Who's signed in. Only an answer says so: no connection, or a server restarting (a deploy), is no answer — the app
  // keeps asking (1, 2, 4… s, and at once when the device is back online or the tab comes back) rather than show a
  // signed-in player the signed-out landing.
  const [unanswered, setUnanswered] = useState(false);
  const askAgain = useRef<() => void>(() => {});
  useEffect(() => {
    // A sign-in made while this was on its way (the drawn landing page is live at once) is newer: keep it.
    const before = getState().me;
    const settle = (user: typeof before) => {
      if (getState().me === before) setState({ me: user });
      setState({ authChecked: true });
      setUnanswered(false);
    };
    let stopped = false;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () => {
      clearTimeout(timer);
      api
        .me()
        .then(({ user }) => settle(user))
        .catch((err: unknown) => {
          if (stopped) return;
          // A refusal that asking again won't change: signed out, as far as this page can tell.
          const status = err instanceof ApiError ? err.status : 0;
          if (status >= 400 && status < 500 && status !== 429) return settle(null);
          setUnanswered(true);
          timer = setTimeout(ask, delay);
          delay = Math.min(delay * 2, 16_000);
        });
    };
    const soon = () => {
      if (document.visibilityState === 'visible' && !getState().authChecked) {
        delay = 1000;
        ask();
      }
    };
    askAgain.current = soon;
    ask();
    window.addEventListener('online', soon);
    document.addEventListener('visibilitychange', soon);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('online', soon);
      document.removeEventListener('visibilitychange', soon);
    };
  }, []);

  // One realtime connection per signed-in session.
  const userId = me?.id;
  useEffect(() => identify(userId ?? null), [userId]);
  useEffect(() => {
    if (!userId) return;
    // The realtime library is a file of its own: one that didn't arrive (an older build's) is a reload away — or,
    // offline, asked for again once the device is back online or the tab comes back.
    let missing = false;
    const connect = () =>
      realtime()
        .then((r) => r.connectRealtime())
        .then(
          () => {
            missing = false;
          },
          () => {
            missing = true;
            reloadForNewVersion();
          },
        );
    const again = () => {
      if (missing && document.visibilityState === 'visible') void connect();
    };
    void connect();
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('online', again);
      document.removeEventListener('visibilitychange', again);
      // Only once its code is here (or on its way): never loaded, never connected.
      void realtimeCode?.then(
        (r) => r.disconnectRealtime(),
        () => {},
      );
    };
  }, [userId]);

  // An account's push subscription on this device, kept up (a day at a time).
  const pushable = !!me && !me.isGuest;
  useEffect(() => {
    if (pushable) void import('./lib/pushUpkeep').then((push) => push.keepPushUp()).catch(() => {});
  }, [pushable]);

  // A notification tapped while the app is open: the worker brings this window up and says where (public/sw.js).
  const navigate = useNavigate();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const go = (e: MessageEvent) => {
      const to = (e.data as { navigate?: unknown } | null)?.navigate;
      if (typeof to === 'string' && to.startsWith('/')) navigate(to);
    };
    navigator.serviceWorker.addEventListener('message', go);
    // Messages wait until this says they're heard (addEventListener alone doesn't).
    navigator.serviceWorker.startMessages();
    return () => navigator.serviceWorker.removeEventListener('message', go);
  }, [navigate]);

  // Signed in: fetch the other pages in the background once the lobby is up, so a match can open instantly.
  useEffect(() => {
    if (!userId) return;
    const timer = setTimeout(() => prefetchPages({ admin: !!getState().me?.isAdmin }), 1500);
    return () => clearTimeout(timer);
  }, [userId]);

  // The server (and a page it drew for a visitor without a session) already knows: nobody to wait for.
  if (!authChecked && !onServer && !paintedSignedOut && !drawnForEveryone(pathname)) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Background />
        {unanswered ? (
          <div role="status" className="flex flex-col items-center gap-4 px-6 text-center">
            <Spinner className="size-8 text-violet-400" />
            <p className="text-fg-2">Свързваме се със сървъра…</p>
            <Button variant="secondary" onClick={() => askAgain.current()}>
              Опитай пак
            </Button>
          </div>
        ) : (
          <Spinner className="size-8 text-violet-400" />
        )}
      </div>
    );
  }

  return (
    // Players who ask their system for less motion get it in every animation, not just the CSS ones.
    // The light `m` components everywhere, their features loaded after the first screen (`strict`: a full `motion`
    // component would bring them all back into the first download, so it's an error).
    <LazyMotion features={loadMotion} strict>
      <MotionConfig reducedMotion="user">
        <SkipLink />
        <Background />
        <Toasts />
        {me && !isPublicPath(pathname) ? (
          // The frame's own file: here already once a session was on its way (pages/lazy.ts → prefetchApp).
          <PageBoundary>
            <Suspense fallback={<AppLoading />}>
              <SignedIn />
            </Suspense>
          </PageBoundary>
        ) : (
          // The page itself (SignedIn has its header and tab bar around its own <main>).
          <main id="content" className="outline-none">
            {isPublicPath(pathname) ? (
              <PageBoundary>
                <Suspense fallback={<PageLoading />}>
                  <PaintingDone />
                  <Routes>
                    <Route path="/reset-password" element={<ResetPasswordPage />} />
                    <Route path="/verify-email" element={<VerifyEmailPage />} />
                    <Route path="/unsubscribe" element={<UnsubscribePage />} />
                    <Route path="/privacy" element={<PrivacyPage />} />
                    <Route path="/terms" element={<TermsPage />} />
                    <Route path="/delete-account" element={<DeleteAccountPage />} />
                    <Route path="/how-to-play" element={<HowToPlayPage />} />
                    <Route path="/quiz" element={<QuizHubPage />} />
                    <Route path="/quiz/:category" element={<QuizCategoryPage />} />
                    <Route path="/facts" element={<FactsPage />} />
                    <Route path="/teachers" element={<TeachersPage />} />
                  </Routes>
                </Suspense>
              </PageBoundary>
            ) : routeKind(pathname) === 'unknown' ? (
              // Signed out on a mistyped link: say so, rather than show the sign-up form as if the link were the site.
              <NotFoundPage standalone />
            ) : (
              <Suspense fallback={<PageLoading />}>
                <AuthPage />
                <PaintingDone />
              </Suspense>
            )}
          </main>
        )}
        {/* Renders nothing; inside the app (not beside it in main.tsx) so the tree is the one the server draws. */}
        <ReloadForUpdate />
      </MotionConfig>
    </LazyMotion>
  );
}

/**
 * The page the server drew is the app's own now — said from inside the page's own Suspense boundary, which React
 * hydrates after the app's shell: from the shell's effects it came too soon, and the page's first render (a pass later)
 * took itself for one the browser draws. The landing then replayed its entrance on the drawn page (AuthPage's
 * `drawn`): the guest button dropped 30 px and climbed back. Renders nothing, so the drawn markup is unchanged.
 */
function PaintingDone() {
  useEffect(paintingDone, []);
  return null;
}

/** While a page's code arrives (only on a first visit before the background prefetch finishes). */
function PageLoading() {
  return <PageSpinner />;
}

/** While the signed-in frame's code arrives (a first start whose download didn't begin early enough). */
function AppLoading() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner className="size-8 text-violet-400" />
    </div>
  );
}
