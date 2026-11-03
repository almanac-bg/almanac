// The shared game client (packages/client) as the app runs it: what the web gets from the browser, the app gives through
// ClientConfig's hooks — the foreground, the network, the session it holds instead of a cookie.
import { configureClient, getState, setState, useStore } from '@almanac/client';
import type { AppSession, MeUser } from '@almanac/shared';
import * as Application from 'expo-application';
import { Image } from 'expo-image';
import * as Network from 'expo-network';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { feel } from './feedback';
import { endSession, loadSession, saveSession, session } from './session';

/** The server: the site, or another one for development (EXPO_PUBLIC_API_URL=http://192.168.1.5:3001). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://almanac.bg').replace(/\/$/, '');

/** The app's version and build, as the server hears it (X-Almanac-Client): "1.3.0+12". */
export const BUILD = `${Application.nativeApplicationVersion ?? '0'}+${Application.nativeBuildVersion ?? '0'}`;

/** What only the app keeps: whether the server still takes this build (the game's state is the shared client's). */
export const useApp = create<{ updateRequired: boolean }>(() => ({ updateRequired: false }));

configureClient({
  baseUrl: API_URL,
  client: Platform.OS === 'ios' ? 'ios' : 'android',
  build: BUILD,
  // The server no longer takes this build's protocol: the app asks for an update (src/components/UpdateScreen.tsx).
  onUpdateRequired: () => useApp.setState({ updateRequired: true }),
  onResume: (listener) => {
    AppState.addEventListener('change', (state) => {
      if (state === 'active') listener();
    });
  },
  onOnline: (listener) => {
    let online = true;
    Network.addNetworkStateListener(({ isConnected }) => {
      if (isConnected && !online) listener();
      online = isConnected !== false;
    });
  },
  authHeaders: (): Record<string, string> => {
    const token = session()?.token;
    return token ? { authorization: `Bearer ${token}` } : {};
  },
  socketAuth: () => {
    const token = session()?.token;
    return token ? { token } : {};
  },
  effect: feel,
  // The next question's picture, fetched during the reveal before it (expo-image keeps it in its cache).
  preload: ({ src }) => void Image.prefetch(src.startsWith('http') ? src : `${API_URL}${src}`),
});

/** A sign-in's answer: the session to keep, and the player. */
export async function signedIn({ user, session: given }: { user: MeUser; session?: AppSession }) {
  // Without one the server took this for a page, not the app (auth.ts → fromApp): nothing to keep, nothing that works.
  if (!given) throw new Error('Сървърът не даде сесия на приложението.');
  await saveSession(given);
  setState({ me: user, authChecked: true });
}

/** At the start: the session this phone holds, and whose it is (null: nobody signed in, or it ended). */
export async function restore() {
  const held = await loadSession();
  if (!held?.token) {
    setState({ authChecked: true });
    return;
  }
  const { api } = await import('@almanac/client');
  try {
    const { user } = await api.me();
    if (!user) await endSession();
    setState({ me: user, authChecked: true });
  } catch {
    // Offline or the server away: signed in as far as this phone knows; the screens say what's unreachable.
    setState({ authChecked: true });
  }
}

/** Whenever the player is signed out (here, or the server ended the session), the token on the phone goes too. */
useStore.subscribe((now, before) => {
  if (before.me && !now.me && getState().authChecked) void endSession();
});
