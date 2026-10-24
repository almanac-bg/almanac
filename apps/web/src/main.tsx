// Self-hosted fonts: no requests to Google (privacy) and no extra DNS/TLS round-trips.
import '@fontsource-variable/onest';
import '@fontsource-variable/unbounded';
import { configureClient, type Effect } from '@quiz/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
