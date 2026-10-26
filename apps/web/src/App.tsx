import { actions, api, connectRealtime, disconnectRealtime, getState, setState, toast, useStore } from '@quiz/client';
import { routeKind } from '@quiz/shared';
import { MotionConfig } from 'motion/react';
import { Suspense, useEffect, useRef } from 'react';
import { Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { ActiveMatchBar } from './components/ActiveMatchBar';
import { Background } from './components/Background';
import { Invites } from './components/Invites';
import { LegalLinks } from './components/LegalLinks';
import { MaintenanceBanner } from './components/MaintenanceBanner';
import { NavBar } from './components/NavBar';
import { QueueOverlay } from './components/QueueOverlay';
import { SeasonRecap } from './components/SeasonRecap';
import { Toasts } from './components/Toasts';
import { Spinner } from './components/ui';
import { identify } from './lib/monitoring';
import { onServer } from './lib/painted';
import { markReturning } from './lib/returning';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/HomePage';
import {
  AchievementsPage,
  AdminPage,
  ChallengePage,
  FriendsPage,
  GamePage,
  LeaderboardPage,
  LockerPage,
  PrivacyPage,
  ProfilePage,
  prefetchPages,
  ResetPasswordPage,
  RoomPage,
  SettingsPage,
  SubmitPage,
  TermsPage,
  UnsubscribePage,
  VerifyEmailPage,
} from './pages/lazy';
import { NotFoundPage } from './pages/NotFoundPage';

/** Email links and legal pages work whether or not you're signed in. */
const PUBLIC_PATHS = ['/reset-password', '/verify-email', '/unsubscribe', '/privacy', '/terms'];
/** …and the legal pages don't even ask: they read the same either way (and the server may have drawn them). */
const LEGAL_PATHS = ['/privacy', '/terms'];

export function App() {
  const me = useStore((s) => s.me);
  const authChecked = useStore((s) => s.authChecked);
  const { pathname } = useLocation();

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

  useEffect(() => {
    // A sign-in made while this was on its way (the drawn landing page is live at once) is newer: keep it.
    const before = getState().me;
    const settle = (user: typeof before) => {
      if (getState().me === before) setState({ me: user });
    };
    api
      .me()
      .then(({ user }) => settle(user))
      .catch(() => settle(null))
      .finally(() => setState({ authChecked: true }));
  }, []);

  // One realtime connection per signed-in session.
  const userId = me?.id;
  useEffect(() => identify(userId ?? null), [userId]);
  useEffect(() => {
    if (!userId) return;
    connectRealtime();
    return () => {
      disconnectRealtime();
    };
  }, [userId]);

  // Signed in: fetch the other pages in the background once the lobby is up, so a match can open instantly.
  useEffect(() => {
    if (!userId) return;
    const timer = setTimeout(prefetchPages, 1500);
    return () => clearTimeout(timer);
  }, [userId]);

  if (!authChecked && !onServer && !LEGAL_PATHS.includes(pathname)) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Background />
        <Spinner className="size-8 text-violet-400" />
      </div>
    );
  }

  return (
    // Players who ask their system for less motion get it in every animation, not just the CSS ones.
    <MotionConfig reducedMotion="user">
      <Background />
      <Toasts />
      {PUBLIC_PATHS.includes(pathname) ? (
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/unsubscribe" element={<UnsubscribePage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
          </Routes>
        </Suspense>
      ) : me ? (
        <SignedIn />
      ) : routeKind(pathname) === 'unknown' ? (
        // Signed out on a mistyped link: say so, rather than show the sign-up form as if the link were the site.
        <NotFoundPage standalone />
      ) : (
        <AuthPage />
      )}
    </MotionConfig>
  );
}

function SignedIn() {
  const location = useLocation();
  const navigate = useNavigate();
  const gameId = useStore((s) => s.game?.start.gameId);
  const inGame = location.pathname === '/game';

  // Jump into a match the moment one starts (queue pop, room start, reconnect).
  const lastGame = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (gameId && gameId !== lastGame.current && !inGame) navigate('/game');
    lastGame.current = gameId;
  }, [gameId, inGame, navigate]);

  return (
    <>
      {!inGame && <NavBar />}
      {!inGame && <MaintenanceBanner />}
      {!inGame && <ActiveMatchBar />}
      <main className={inGame ? '' : 'mx-auto max-w-6xl px-4 pt-6 pb-28 sm:px-6 md:pb-16'}>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/game" element={<GamePage />} />
            <Route path="/room" element={<RoomPage />} />
            <Route path="/join/:code" element={<JoinRoute />} />
            <Route path="/c/:id" element={<ChallengePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/profile/:username" element={<ProfilePage />} />
            <Route path="/achievements" element={<AchievementsPage />} />
            <Route path="/locker" element={<LockerPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/friends" element={<FriendsPage />} />
            <Route path="/submit" element={<SubmitPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
        {!inGame && <LegalLinks className="mt-16 justify-center" />}
      </main>
      {!inGame && <QueueOverlay />}
      <Invites />
      <SeasonRecap />
    </>
  );
}

/** While a page's code arrives (only on a first visit before the background prefetch finishes). */
function PageLoading() {
  return (
    <div className="grid place-items-center py-24">
      <Spinner className="size-8 text-violet-400" />
    </div>
  );
}

/** Invite links: /join/12345 drops you straight into the room. */
function JoinRoute() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const connected = useStore((s) => s.connected);
  const tried = useRef(false);

  useEffect(() => {
    if (!connected || tried.current) return;
    tried.current = true;
    actions.joinRoom(code).then((res) => {
      if (res.ok) navigate('/room', { replace: true });
      else {
        toast({ kind: 'error', title: res.error });
        navigate('/', { replace: true });
      }
    });
  }, [connected, code, navigate]);

  return (
    <div className="grid place-items-center py-24">
      <Spinner className="size-8 text-violet-400" />
    </div>
  );
}
