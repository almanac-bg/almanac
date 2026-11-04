// Notifications on this phone: on after the consent (the token to the server), off again, blocked by the phone's own
// settings; what to send, saved for all devices; and a push tapped opening where it leads.
import { api, setState } from '@almanac/client';
import { defaultPushPrefs } from '@almanac/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Alert, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { usePush } from '@/lib/push';
import { PushSection } from '@/settings/PushSection';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  getDevicePushTokenAsync: jest.fn(async () => ({ type: 'ios', data: 'tok-1' })),
  setNotificationHandler: jest.fn(),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const me = { id: 1, username: 'Ана', isGuest: false, push: defaultPushPrefs() };

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
  mockStore.clear();
  setState({ me: me as never });
});

test('on after the consent: the phone asks, its token goes to the server; then off again', async () => {
  const register = jest.spyOn(api, 'registerPushDevice').mockResolvedValue({ user: me as never });
  const forget = jest.spyOn(api, 'forgetPushDevice').mockResolvedValue({ ok: true });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await show(<PushSection />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Включи на този телефон' })).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'Включи на този телефон' }));
  // The consent first: 14 or older, or a parent's.
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(alert.mock.calls[0]?.[1]).toMatch(/навършени 14 години/);
  await act(async () => alert.mock.calls[0]?.[2]?.find((b) => b.text === 'Потвърждавам, включи')?.onPress?.());
  expect(register).toHaveBeenCalledWith('tok-1', true);
  await waitFor(() => expect(screen.getByText('✓ Включени на този телефон')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'Изключи тук' }));
  expect(forget).toHaveBeenCalledWith('tok-1');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Включи на този телефон' })).toBeTruthy());
});

test('stopped in the phone’s own settings: said so, with the way there', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: false } as never);
  await show(<PushSection />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Към настройките на телефона' })).toBeTruthy());
});

test('what to send, saved for every device: a kind switched off, the daily reminder set', async () => {
  const save = jest
    .spyOn(api, 'setPushPrefs')
    .mockImplementation(async (prefs) => ({ user: { ...me, push: prefs } as never }));
  await show(<PushSection />);
  await fireEvent(screen.getByLabelText('Твой ред в дуел'), 'valueChange', false);
  expect(save).toHaveBeenCalledWith({ ...defaultPushPrefs(), kinds: { ...defaultPushPrefs().kinds, duels: false } });
  await fireEvent.press(screen.getByRole('radio', { name: '18:30' }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ daily: 18 * 60 + 30 })));
});

function Hooked() {
  usePush();
  return <Text>ok</Text>;
}

test('a push tapped opens where it leads; the one that opened the app, once', async () => {
  jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue({
    notification: { request: { content: { data: {} }, trigger: { payload: { url: '/c/abc' } } } },
  } as never);
  await show(<Hooked />);
  expect(router.push).toHaveBeenCalledWith('/c/abc');
  expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
  const tapped = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock.calls[0]?.[0];
  await act(async () =>
    tapped?.({ notification: { request: { content: { data: { url: '/friends' } }, trigger: null } } } as never),
  );
  expect(router.push).toHaveBeenLastCalledWith('/friends');
});
