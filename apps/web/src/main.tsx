// Self-hosted fonts: no requests to Google (privacy) and no extra DNS/TLS round-trips.
import '@fontsource-variable/onest';
import '@fontsource-variable/unbounded';
import { ApiError, configureClient, type Effect, reportError, setState } from '@quiz/client';
import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ReloadForUpdate } from './components/ReloadForUpdate';
import { startMonitoring } from './lib/monitoring';
import { paintedSignedOut } from './lib/painted';
import { sfx } from './lib/sound';
import { preloadPage } from './pages/lazy';
import './styles.css';

const SOUNDS: Partial<Record<Effect, () => void>> = {
  lock: sfx.lock,
  correct: sfx.correct,
  wrong: sfx.wrong,
  powerup: sfx.powerup,
  freeze: sfx.freeze,
  eliminated: sfx.eliminated,
  achievement: sfx.achievement,
  invite: sfx.achievement,
};

// Same-origin API, httpOnly session cookie.
configureClient({ baseUrl: '', effect: (name) => SOUNDS[name]?.() });

// Script errors and failed promises outside React's reach. Browser extensions' errors and expected API failures
// (shown to the player already) aren't ours to report.
window.addEventListener('error', (event) => {
  if (event.filename && !event.filename.startsWith(window.location.origin)) return;
  // "Script error." is a muted error from code on another origin: no details, nothing to act on.
  if (event.message === 'Script error.' || /ResizeObserver loop/.test(event.message)) return;
  reportError('error', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  if (!(event.reason instanceof ApiError)) reportError('rejection', event.reason);
});

// A tab opened before a deploy may ask for page code that no longer exists: reload once to get the new version.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (Date.now() - Number(sessionStorage.getItem('quiz:reloadedAt') ?? 0) < 10_000) return; // already tried
    sessionStorage.setItem('quiz:reloadedAt', String(Date.now()));
  } catch {
    /* storage unavailable: reload anyway */
  }
  event.preventDefault();
  window.location.reload();
});

startMonitoring();

// The landing page the server drew for a visitor without a session (lib/painted.ts): no need to ask who's signed in
// before showing it. (The app still asks, in the background.)
if (paintedSignedOut) setState({ authChecked: true, me: null });

const root = createRoot(document.getElementById('root')!);
// The page's code first (the legal pages load on demand), then the whole app in one synchronous render: a page the
// server drew is swapped for the same page with no frame of "loading" in between.
preloadPage(window.location.pathname)
  .catch(() => {})
  .then(() =>
    flushSync(() =>
      root.render(
        <StrictMode>
          <ErrorBoundary>
            <BrowserRouter>
              <ReloadForUpdate />
              <App />
            </BrowserRouter>
          </ErrorBoundary>
        </StrictMode>,
      ),
    ),
  );
