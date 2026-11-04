// A link opened while signed out: kept, said on the way in (a room's code makes a guest only for the room), and
// opened once someone is in.
import { api, setState } from '@almanac/client';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Welcome from '@/app/welcome';
import { pathOf, useEntry, useEntryLinks } from '@/lib/entry';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('expo-linking', () => ({ useURL: jest.fn(() => null) }));

const show = (children: React.ReactNode) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      {children}
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  useEntry.setState({ path: null });
  setState({ me: null });
});

test('a link’s path in the app, from the site’s address or the app’s own; what the app has no screen for, none', () => {
  expect(pathOf('https://almanac.bg/join/123456')).toBe('/join/123456');
  expect(pathOf('almanac://c/abc123')).toBe('/c/abc123');
  expect(pathOf('exp://192.168.1.5:8081/--/daily/x7Kp2q')).toBe('/daily/x7Kp2q');
  expect(pathOf('https://almanac.bg/how-to-play')).toBeNull();
});

test('a room’s code waiting: said on the way in, and a guest only for that room', async () => {
  useEntry.setState({ path: '/join/123456' });
  const guest = jest
    .spyOn(api, 'guest')
    .mockResolvedValue({ user: { id: 1 } as never, session: { token: 't', device: 'd' } } as never);
  await show(<Welcome />);
  expect(screen.getByText(/Имаш покана за стая 123456/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Играй като гост' }));
  expect(guest).toHaveBeenCalledWith(true);
});

function Hooked() {
  useEntryLinks();
  return <Text>ok</Text>;
}

test('opened while signed out, the link waits — and opens once someone is in', async () => {
  jest.mocked(Linking.useURL).mockReturnValue('https://almanac.bg/c/abc123');
  await show(<Hooked />);
  expect(useEntry.getState().path).toBe('/c/abc123');
  expect(router.push).not.toHaveBeenCalled();
  await act(async () => setState({ me: { id: 1, username: 'Гост 7' } as never }));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith('/c/abc123'));
  expect(useEntry.getState().path).toBeNull();
});
