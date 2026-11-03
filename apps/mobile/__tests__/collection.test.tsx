// Колекция and Постижения: something of yours worn with a tap, something locked saying what it takes, a level's reward
// waiting — and the achievements with their progress, filtered.
import { api, setState, useStore } from '@almanac/client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Achievements from '@/app/achievements';
import Locker from '@/app/locker';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));

const me = {
  id: 1,
  username: 'Ана',
  avatar: 'fox',
  frame: 'classic',
  title: 'spark',
  xp: 1200,
  isGuest: false,
  achievements: ['first_game'],
  bestSeasonTier: -1,
  mastery: [],
  eveningChampion: false,
  chosen: [],
  choices: [],
};

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
  setState({ me: me as never });
});

test('an avatar of yours worn with a tap; a locked one says what it takes', async () => {
  const loadout = jest.spyOn(api, 'loadout').mockResolvedValue({ user: { ...me, avatar: 'owl' } as never });
  await show(<Locker />);
  await fireEvent.press(screen.getByRole('button', { name: 'Бухал' }));
  expect(loadout).toHaveBeenCalledWith({ avatar: 'owl' });
  await waitFor(() => expect(useStore.getState().me?.avatar).toBe('owl'));
  await fireEvent.press(screen.getByRole('button', { name: 'Извънземно, Ниво 11 (заключено)' }));
  expect(screen.getByText('🔒 Отключва се с')).toBeTruthy();
  expect(screen.getByText(/още 4300 XP$/)).toBeTruthy();
});

test('a level’s reward waiting at the top: picked, and said', async () => {
  setState({
    me: {
      ...me,
      choices: [
        {
          level: 5,
          options: [
            { kind: 'avatar', id: 'hedgehog' },
            { kind: 'avatar', id: 'otter' },
          ],
          earlier: [],
        },
      ],
    } as never,
  });
  const choose = jest.spyOn(api, 'chooseReward').mockResolvedValue({ user: { ...me, choices: [] } as never });
  await show(<Locker />);
  expect(screen.getByText('🎁 Ниво 5: избери награда')).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: 'Таралеж, аватар' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Вземи „Таралеж“' }));
  expect(choose).toHaveBeenCalledWith(5, { kind: 'avatar', id: 'hedgehog' });
  await waitFor(() => expect(useStore.getState().toasts.at(-1)?.title).toBe('Взе „Таралеж“'));
});

test('the titles and their mastery tiers; the козове with what they do', async () => {
  await show(<Locker />);
  await fireEvent.press(screen.getByRole('radio', { name: /^Титли / }));
  expect(screen.getByText('Майсторство')).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: 'Козове' }));
  expect(screen.getByText('Премахва два грешни отговора.')).toBeTruthy();
});

test('the achievements: how many, each with its progress, the locked ones on their own', async () => {
  jest.spyOn(api, 'achievements').mockResolvedValue({
    achievements: [
      { id: 'first_game', unlockedAt: Date.now() - 86_400_000, progress: null },
      { id: 'games_10', unlockedAt: null, progress: 4 },
    ],
  } as never);
  await show(<Achievements />);
  await waitFor(() => expect(screen.getByText(/^✓ Отключено на /)).toBeTruthy());
  await fireEvent.press(screen.getByRole('radio', { name: 'Заключени' }));
  expect(screen.queryByText(/^✓ Отключено на /)).toBeNull();
});
