import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { Background } from './components/Background';
import { Invites } from './components/Invites';
import { NavBar } from './components/NavBar';
import { QueueOverlay } from './components/QueueOverlay';
import { SeasonRecap } from './components/SeasonRecap';
import { Toasts } from './components/Toasts';
import { Spinner } from './components/ui';
import { api } from './lib/api';
import { actions, socket } from './lib/socket';
import { setState, toast, useStore } from './lib/store';
import { AchievementsPage } from './pages/AchievementsPage';
import { AdminPage } from './pages/AdminPage';
import { AuthPage } from './pages/AuthPage';
import { FriendsPage } from './pages/FriendsPage';
import { GamePage } from './pages/GamePage';
import { HomePage } from './pages/HomePage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { LockerPage } from './pages/LockerPage';
import { ProfilePage } from './pages/ProfilePage';
import { RoomPage } from './pages/RoomPage';
import { SubmitPage } from './pages/SubmitPage';

export function App() {
  const me = useStore((s) => s.me);
  const authChecked = useStore((s) => s.authChecked);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => setState({ me: user }))
      .catch(() => setState({ me: null }))
      .finally(() => setState({ authChecked: true }));
  }, []);

  // One realtime connection per signed-in session.
  const userId = me?.id;
  useEffect(() => {
    if (!userId) return;
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, [userId]);

  if (!authChecked) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Background />
        <Spinner className="size-8 text-violet-400" />
      </div>
    );
  }

  return (
    <>
      <Background />
      <Toasts />
      {me ? <SignedIn /> : <AuthPage />}
    </>
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
      <main className={inGame ? '' : 'mx-auto max-w-6xl px-4 pt-6 pb-28 sm:px-6 md:pb-16'}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/game" element={<GamePage />} />
          <Route path="/room" element={<RoomPage />} />
          <Route path="/join/:code" element={<JoinRoute />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:username" element={<ProfilePage />} />
          <Route path="/achievements" element={<AchievementsPage />} />
          <Route path="/locker" element={<LockerPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/submit" element={<SubmitPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!inGame && <QueueOverlay />}
      <Invites />
      <SeasonRecap />
    </>
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
