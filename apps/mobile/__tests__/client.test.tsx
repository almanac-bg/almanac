// The shared client as the app runs it (src/lib/client.ts): the session from the keychain goes out as a Bearer token on
// /api and in the socket's auth, a sign-in's session is kept, and signing out takes the token (not the device mark).
import { clientConfig, getState, setState } from '@almanac/client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
  };
});
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));

const user = { id: 7, username: 'Гост_1234567', isGuest: true };
const sent: { url: string; headers: Headers }[] = [];
globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  sent.push({ url: String(input), headers: new Headers(init?.headers) });
  return new Response(JSON.stringify({ user, session: { token: 'app-token-'.padEnd(43, 'x') } }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

// After the mocks: the module configures the client when it loads.
const { restore, signedIn } = require('@/lib/client') as typeof import('@/lib/client');
const Welcome = (require('@/app/welcome') as typeof import('@/app/welcome')).default;

beforeEach(() => setState({ me: null, authChecked: true }));

/** As the root layout renders a screen: inside the phone's safe area (an iPhone's, here). */
const renderScreen = (ui: React.ReactElement) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      {ui}
    </SafeAreaProvider>,
  );

test('the app says what it is on every request: its platform, protocol and build', () => {
  const { client, build } = clientConfig();
  expect(client === 'ios' || client === 'android').toBe(true);
  expect(build).toMatch(/^[\w.]+\+[\w.]+$/);
});

test('a guest’s way in: the session comes in the answer, is kept on the phone, and goes out as Bearer', async () => {
  await renderScreen(<Welcome />);
  await fireEvent.press(screen.getByRole('button', { name: 'Играй като гост' }));
  // Signed in: the player is in the store, and the router takes them to the tabs (_layout.tsx).
  await waitFor(() => expect(getState().me?.username).toBe('Гост_1234567'));
  expect(sent.at(-1)?.url).toMatch(/\/api\/auth\/guest$/);
  expect(SecureStore.setItemAsync).toHaveBeenCalled();
  const token = 'app-token-'.padEnd(43, 'x');
  expect(clientConfig().authHeaders?.()).toEqual({ authorization: `Bearer ${token}` });
  expect(clientConfig().socketAuth?.()).toEqual({ token });
});

test('a sign-in without a session in its answer (the server took the app for a page) is refused, not half-done', async () => {
  await expect(signedIn({ user } as never)).rejects.toThrow('сесия');
});

test('signed out, the token leaves the phone: no Bearer goes out after', async () => {
  await signedIn({ user: user as never, session: { token: 't'.repeat(43), device: 'dev.sig' } });
  setState({ me: null });
  await waitFor(() => expect(clientConfig().authHeaders?.()).toEqual({}));
  // The device mark stays, for the next sign-in's allowance (the server's knownDevice).
  const kept = JSON.parse((await SecureStore.getItemAsync('almanac.session')) ?? '{}');
  expect(kept).toEqual({ token: '', device: 'dev.sig' });
  // …and starting again with it isn't a signed-in start.
  await restore();
  expect(clientConfig().authHeaders?.()).toEqual({});
});

test('the way in says what playing accepts, and links the terms and the policy', async () => {
  await renderScreen(<Welcome />);
  expect(screen.getByRole('link', { name: 'Условията за ползване' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Политиката за поверителност' })).toBeTruthy();
  expect(screen.getByText(/под 14/)).toBeTruthy();
});
