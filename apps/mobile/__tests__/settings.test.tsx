// Settings: a guest saves the account (and keeps the session that comes with it), the theme follows the choice, an
// account's choices are saved, and deleting asks first.
import { api, getState, setState } from '@almanac/client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Alert, Appearance } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Settings from '@/app/settings';

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

const guest = {
  id: 9,
  username: 'Гост_7654321',
  avatar: 'fox',
  xp: 300,
  isGuest: true,
  moreTime: 'off',
  shareRuns: true,
  email: null,
  pendingEmail: null,
  emailBounced: false,
  streakReminders: false,
  beatenMails: false,
};
const account = { ...guest, isGuest: false, username: 'Ана' };

const show = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <Settings />
    </SafeAreaProvider>,
  );

beforeEach(() => jest.clearAllMocks());

test('a guest saves the account: a new session comes with it, and is kept', async () => {
  setState({ me: guest as never });
  jest
    .spyOn(api, 'claim')
    .mockResolvedValue({ user: account as never, session: { token: 's'.repeat(43), device: 'd.sig' } });
  await show();
  await fireEvent.changeText(screen.getByLabelText('Име'), 'Ана');
  await fireEvent.changeText(screen.getByLabelText('Парола'), 'parola-123');
  await fireEvent.press(screen.getByRole('button', { name: 'Запази профила' }));
  await waitFor(() => expect(getState().me?.username).toBe('Ана'));
  expect(api.claim).toHaveBeenCalledWith('Ана', 'parola-123', undefined);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    'almanac.session',
    expect.stringContaining('s'.repeat(43)),
    expect.anything(),
  );
});

test('the theme follows the choice, the whole app (Appearance) with it', async () => {
  setState({ me: account as never });
  const appearance = jest.spyOn(Appearance, 'setColorScheme');
  await show();
  await fireEvent.press(screen.getByRole('radio', { name: 'Светла' }));
  expect(appearance).toHaveBeenCalledWith('light');
  await fireEvent.press(screen.getByRole('radio', { name: 'Като телефона' }));
  expect(appearance).toHaveBeenLastCalledWith('unspecified');
});

test('an account’s choice is saved at once: the recordings, „Повече време“', async () => {
  setState({ me: account as never });
  const shareRuns = jest
    .spyOn(api, 'setShareRuns')
    .mockResolvedValue({ user: { ...account, shareRuns: false } as never });
  const moreTime = jest
    .spyOn(api, 'setMoreTime')
    .mockResolvedValue({ user: { ...account, moreTime: 'relaxed' } as never });
  await show();
  await fireEvent(screen.getByLabelText('Записите на мачовете ми'), 'valueChange', false);
  expect(shareRuns).toHaveBeenCalledWith(false);
  await fireEvent.press(screen.getByRole('radio', { name: '30 с' }));
  expect(moreTime).toHaveBeenCalledWith('relaxed');
});

test('deleting the account asks first, then signs out', async () => {
  setState({ me: account as never });
  const remove = jest.spyOn(api, 'deleteAccount').mockResolvedValue({ ok: true });
  jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _text, buttons) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
  await show();
  await fireEvent.changeText(screen.getByLabelText('Потвърди с паролата си'), 'parola-123');
  await fireEvent.press(screen.getByRole('button', { name: 'Изтрий профила' }));
  await waitFor(() => expect(getState().me).toBeNull());
  expect(remove).toHaveBeenCalledWith('parola-123');
});
