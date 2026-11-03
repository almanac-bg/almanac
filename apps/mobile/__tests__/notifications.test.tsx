// Известия: the list marked seen on opening, a note's link opened where it's best seen, and the bell's count.
import { api, setState, useStore } from '@almanac/client';
import type { AppNotification } from '@almanac/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Notifications from '@/app/notifications';
import { NotificationsBell } from '@/home/Bell';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));

const note = (id: number, text: string, link: string | null, read = false): AppNotification => ({
  id,
  icon: '🔔',
  text,
  link,
  createdAt: Date.now() - 3_600_000,
  read,
});

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
  setState({ me: { id: 7, username: 'Ана', isGuest: false, unreadNotifications: 2 } as never });
});

test('opening the list marks it seen; a link goes to its screen, or to the site', async () => {
  jest.spyOn(api, 'notifications').mockResolvedValue({
    notifications: [
      note(1, 'Мария те добави за приятел', '/profile/Мария'),
      note(2, 'Някой изигра линка ти', '/c/abc123'),
      note(3, 'Въпросът ти е одобрен', null, true),
      note(4, 'Правилата на „Подреди“ са обновени', '/how-to-play', true),
    ],
  });
  const read = jest.spyOn(api, 'readNotifications').mockResolvedValue({ ok: true });
  await show(<Notifications />);
  await waitFor(() => expect(screen.getByText('Мария те добави за приятел')).toBeTruthy());
  await waitFor(() => expect(useStore.getState().me?.unreadNotifications).toBe(0));
  expect(read).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText('ново')).toHaveLength(2);
  await fireEvent.press(screen.getByRole('link', { name: /^Ново: Мария те добави за приятел/ }));
  expect(router.push).toHaveBeenCalledWith('/profile/Мария');
  await fireEvent.press(screen.getByRole('link', { name: /^Ново: Някой изигра линка ти/ }));
  expect(router.push).toHaveBeenCalledWith('/c/abc123');
  // A page of the site the app doesn't take: the site, in the in-app browser.
  await fireEvent.press(screen.getByRole('link', { name: /^Правилата на „Подреди“/ }));
  expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://almanac.bg/how-to-play');
});

test('nothing new: no call to mark it seen, and the empty line', async () => {
  jest.spyOn(api, 'notifications').mockResolvedValue({ notifications: [] });
  const read = jest.spyOn(api, 'readNotifications').mockResolvedValue({ ok: true });
  await show(<Notifications />);
  await waitFor(() => expect(screen.getByText('Нищо ново')).toBeTruthy());
  expect(read).not.toHaveBeenCalled();
});

test('the bell says how many are new, and opens the list', async () => {
  await show(<NotificationsBell />);
  await fireEvent.press(screen.getByRole('button', { name: 'Известия, 2 нови' }));
  expect(router.push).toHaveBeenCalledWith('/notifications');
});
