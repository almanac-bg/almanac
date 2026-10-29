import { ApiError, configureClient, type Effect, setState } from '@quiz/client';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PICTURE_SIZES } from './components/game/QuestionPicture';
import { reportCrash, startMonitoring } from './lib/monitoring';
import { isPainted, paintedSignedOut } from './lib/painted';
import { upgradeReturning } from './lib/returning';
import { buzz, sfx, unlockAudioOnFirstTap } from './lib/sound';
import { watchSystemTheme } from './lib/theme';
import { preloadPage } from './pages/lazy';
import './styles.css';

// Every page opens at the top (App scrolls there on each move). Left to the browser, a step back through history also
// brings back the old entry's scroll: the results of a match begun from a scrolled lobby opened half-way down.
window.history.scrollRestoration = 'manual';

const SOUNDS: Partial<Record<Effect, () => void>> = {
  lock: sfx.lock,
  correct: sfx.correct,
  wrong: sfx.wrong,
  powerup: sfx.powerup,
  eliminated: sfx.eliminated,
  knockedOut: sfx.knockedOut,
  achievement: sfx.achievement,
  invite: sfx.invite,
  round: sfx.go,
  leadTaken: () => sfx.lead(true),
  leadLost: () => sfx.lead(false),
};

/** Felt, not heard: a tap for your pick, a double pulse for right, a thud for wrong, a long one for being knocked out. */
const HAPTICS: Partial<Record<Effect, number | number[]>> = {
  lock: 12,
  correct: [18, 50, 18],
  wrong: 90,
  knockedOut: [180, 70, 260],
};

/** Pictures being fetched ahead: held until they're in, so the fetch isn't dropped with an unreferenced image. */
const preloading = new Set<HTMLImageElement>();

// Same-origin API, httpOnly session cookie.
configureClient({
  baseUrl: '',
  effect: (name) => {
    SOUNDS[name]?.();
    buzz(HAPTICS[name]);
  },
  // The size the question will show it at (PICTURE_SIZES): the same file the browser will want then.
  preload: ({ src, srcSet }) => {
    const img = new Image();
    img.sizes = PICTURE_SIZES;
    img.srcset = srcSet;
    img.src = src;
    preloading.add(img);
    const done = () => preloading.delete(img);
    img.onload = done;
    img.onerror = done;
  },
});

// Script errors and failed promises outside React's reach. Browser extensions' errors and expected API failures
// (shown to the player already) aren't ours to report.
window.addEventListener('error', (event) => {
  if (event.filename && !event.filename.startsWith(window.location.origin)) return;
  reportCrash('error', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  if (!(event.reason instanceof ApiError)) reportCrash('rejection', event.reason);
});

startMonitoring();
// public/theme.js put the chosen theme on before the first paint; this keeps up with the device's own while it's the
// choice.
watchSystemTheme();
unlockAudioOnFirstTap();

// Installed or not: without a connection, a page shows "Няма връзка" instead of the browser's error (public/sw.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// The landing page the server drew for a visitor without a session (lib/painted.ts): no need to ask who's signed in
// before showing it. (The app still asks, in the background.)
if (paintedSignedOut) setState({ authChecked: true, me: null });
upgradeReturning();

const container = document.getElementById('root')!;
const app = (
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);
// A page the server drew is hydrated, not drawn again: it stays on screen as it is and becomes interactive (a tap
// that comes before that is replayed). Its code first, for the legal pages, which load on demand.
const drawn = isPainted();
preloadPage(window.location.pathname)
  .catch(() => {})
  .then(() => (drawn ? hydrateRoot(container, app) : createRoot(container).render(app)));
