import { actions, getState, setState, toast, useStore } from '@quiz/client';
import { type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { ActiveMatchBar } from './components/ActiveMatchBar';
import { ConnectionBanner } from './components/ConnectionBanner';
import { FrameBoundary, PageBoundary } from './components/ErrorBoundary';
import { Invites } from './components/Invites';
import { LegalLinks } from './components/LegalLinks';
import { MaintenanceBanner } from './components/MaintenanceBanner';
import { NavBar } from './components/NavBar';
import { PasswordConfirm } from './components/PasswordConfirm';
import { QueueOverlay } from './components/QueueOverlay';
import { RoomDoor, RoomNickname } from './components/RoomNickname';
import { SeasonRecap } from './components/SeasonRecap';
import { SecondFactorPrompt } from './components/SecondFactor';
import { Card, PageSpinner } from './components/ui';
import { APP_PAGES } from './pages/lazy';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * The app around a signed-in player's pages: the header and tab bar, invites, banners, the queue, the prompts. A file
 * of its own, loaded with the lobby (pages/lazy.ts → prefetchApp, prefetchStart): a visitor who never signs in never
 * downloads it (the 31 October review, WEB-5).
 */
export function SignedIn() {
  const location = useLocation();
  const navigate = useNavigate();
  const gameId = useStore((s) => s.game?.start.gameId);
  const maintenance = useStore((s) => !!s.maintenance);
  const inGame = location.pathname === '/game';
  // A room's host with „Само водя“: the room page is the class's projector lobby — no app chrome round it, as in the
  // match it leads to (it has its own header, with the way out).
  const projecting = useStore(
    (s) => location.pathname === '/room' && !!s.room && !s.room.settings.hostPlays && s.room.hostId === `u${s.me?.id}`,
  );
  const bare = inGame || projecting;

  // Jump into a match the moment one starts (queue pop, room start, reconnect).
  const lastGame = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (gameId && gameId !== lastGame.current && !inGame) navigate('/game');
    lastGame.current = gameId;
  }, [gameId, inGame, navigate]);

  // Each piece of the frame on its own: one that crashes goes quiet, the page and the connection stay (WEB-8).
  const frame = (name: string, piece: ReactNode) => (
    <FrameBoundary name={name} resetKey={location.pathname}>
      {piece}
    </FrameBoundary>
  );

  return (
    <>
      {!bare && frame('nav', <NavBar />)}
      {/* Right after the header, not after the page: an invite lasts a minute, and a keyboard reached it after the
          whole lobby (22 Tabs and more). */}
      {frame('invites', <Invites />)}
      {!bare && frame('maintenance', <MaintenanceBanner />)}
      {!bare && frame('active match', <ActiveMatchBar />)}
      <main
        id="content"
        className={
          inGame
            ? 'outline-none'
            : projecting
              ? 'mx-auto max-w-7xl px-6 py-6 outline-none lg:px-12'
              : 'mx-auto max-w-6xl px-4 pt-6 pb-28 outline-none cramped:pb-8 sm:px-6 md:pb-16'
        }
      >
        <PageBoundary>
          <Suspense fallback={<PageSpinner />}>
            <Routes>
              {APP_PAGES.map(([path, Page]) => (
                <Route key={path} path={path} element={<Page />} />
              ))}
              <Route path="/join/:code" element={<JoinRoute />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </PageBoundary>
        {!bare && <LegalLinks className="mt-16 justify-center" />}
      </main>
      {!bare && frame('queue', <QueueOverlay />)}
      {frame('connection', <ConnectionBanner explained={!inGame && maintenance} />)}
      {frame('season recap', <SeasonRecap />)}
      {frame('password prompt', <PasswordConfirm />)}
      {frame('second factor', <SecondFactorPrompt />)}
    </>
  );
}

/** What the server says to a code no room has (rooms.ts → join). */
const NO_SUCH_ROOM = 'Няма стая с този код.';

/**
 * Invite links: /join/123456 drops you straight into the room — a guest first says what to call them there. A locked
 * room keeps you at its door until the host lets you in or not; leaving this page leaves the door.
 */
function JoinRoute() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  // The name given on the way here, when a mistyped code was corrected: joined with it at once (UX-11).
  const carried = (useLocation().state as { nickname?: string } | null)?.nickname ?? null;
  const connected = useStore((s) => s.connected);
  const guest = useStore((s) => !!s.me?.isGuest);
  const inside = useStore((s) => s.room?.code === code);
  const knock = useStore((s) => (s.knock?.code === code ? s.knock : null));
  const tried = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In: straight away, or once the host opens the door (the room's state comes before any answer to joining).
  useEffect(() => {
    if (inside) navigate('/room', { replace: true });
  }, [inside, navigate]);

  useEffect(
    () => () => {
      const { knock } = getState();
      if (knock?.code !== code) return;
      if (knock.refused) setState({ knock: null });
      else actions.leaveRoom();
    },
    [code],
  );

  useEffect(() => {
    if (guest || !connected || tried.current) return;
    tried.current = true;
    actions.joinRoom(code).then((res) => {
      if (res.ok) return;
      toast({ kind: 'error', title: res.error });
      navigate('/', { replace: true });
    });
  }, [guest, connected, code, navigate]);

  async function joinAs(nickname: string, corrected?: string) {
    // Another code typed in: that room's address, the name with it.
    if (corrected && corrected !== code) {
      setError(null);
      navigate(`/join/${corrected}`, { replace: true, state: { nickname } });
      return;
    }
    setBusy(true);
    const res = await actions.joinRoom(code, nickname);
    setBusy(false);
    if (!res.ok) setError(res.error);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: once per code, with the name carried to it
  useEffect(() => {
    if (guest && connected && carried) void joinAs(carried);
  }, [code, guest, connected]);

  if (knock)
    return (
      <div className="mx-auto max-w-md">
        <Card className="p-6 sm:p-8">
          <RoomDoor code={code} refused={knock.refused} onLeave={() => navigate('/', { replace: true })} />
        </Card>
      </div>
    );
  if (!guest) return <PageSpinner />;
  return (
    <div className="mx-auto max-w-md">
      <Card className="p-6 sm:p-8">
        <RoomNickname
          key={code}
          code={code}
          busy={busy}
          error={error}
          // No room with this code: the code itself to check, beside the name (it was a dead end).
          wrongCode={error === NO_SUCH_ROOM}
          onJoin={(n, corrected) => void joinAs(n, corrected)}
        />
      </Card>
    </div>
  );
}
