// The way in, through the real router (src/app): signed out, the app opens on the welcome — „Играй като гост“ — wherever
// it was asked to start, and a sign-in form's „Назад“ always leads somewhere.
import path from 'node:path';
import { setState } from '@almanac/client';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
// What reaches out (the server, the phone's push service) stays out: the session is set here.
jest.mock('@/lib/realtime', () => ({ useRealtime: () => {} }));
jest.mock('@/lib/push', () => ({ usePush: () => {} }));
jest.mock('@/lib/client', () => ({ ...jest.requireActual('@/lib/client'), restore: jest.fn(async () => {}) }));

const app = path.join(__dirname, '../src/app');

beforeEach(() => setState({ me: null, authChecked: true }));

test('signed out, the app opens on the welcome, not the sign-in form', async () => {
  await renderRouter(app, { initialUrl: '/' });
  expect(await screen.findByText('Играй като гост')).toBeTruthy();
  expect(screen).toHavePathname('/welcome');
});

test('a signed-in screen asked for while signed out leads to the welcome too', async () => {
  await renderRouter(app, { initialUrl: '/settings' });
  expect(await screen.findByText('Играй като гост')).toBeTruthy();
  expect(screen).toHavePathname('/welcome');
});

test('the sign-in form opened first: „Назад“ goes to the welcome, not nowhere', async () => {
  await renderRouter(app, { initialUrl: '/sign-in' });
  await act(async () => fireEvent.press(await screen.findByRole('button', { name: 'Назад' })));
  expect(await screen.findByText('Играй като гост')).toBeTruthy();
  expect(screen).toHavePathname('/welcome');
});
