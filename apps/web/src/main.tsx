// Self-hosted fonts: no requests to Google (privacy) and no extra DNS/TLS round-trips.
import '@fontsource-variable/onest';
import '@fontsource-variable/unbounded';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
