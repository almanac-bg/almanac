// Self-hosted fonts: no requests to Google (privacy) and no extra DNS/TLS round-trips.
import '@fontsource-variable/onest';
import '@fontsource-variable/unbounded';
import { ApiError, configureClient, type Effect, reportError } from '@quiz/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ReloadForUpdate } from './components/ReloadForUpdate';
import { startMonitoring } from './lib/monitoring';
import { sfx } from './lib/sound';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ReloadForUpdate />
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
