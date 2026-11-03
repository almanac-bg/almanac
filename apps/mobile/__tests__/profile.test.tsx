// A player's profile: their numbers, a friend added, a report sent, a block asked first — and your own with Settings.
import { api, setState } from '@almanac/client';
import type { ProfileStats } from '@almanac/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProfileView } from '@/profile/ProfileView';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

const profile = (more: Partial<ProfileStats> = {}): ProfileStats => ({
  user: { id: 9, username: 'Мария', avatar: 'fox', frame: 'classic', title: 'spark', xp: 2400, createdAt: 0 } as never,
  friendship: 'none',
  blocked: false,
  duels: null,
  overview: {
    gamesPlayed: 40,
    multiplayerGames: 20,
    wins: 10,
    questionsAnswered: 400,
    correctAnswers: 300,
    bestStreak: 12,
    fastestCorrectMs: 1200,
    avgCorrectMs: 4100,
    bestSoloScore: 9800,
    powerupsUsed: 3,
    dailyStreak: 4,
    bestDailyStreak: 9,
    questionsApproved: 0,
  },
  modes: [
    { mode: 'solo', games: 20, wins: 0, avgPlacement: null, rating: null },
    { mode: 'duel', games: 20, wins: 10, avgPlacement: 1.5, rating: 1260 },
  ],
  categories: [{ category: 'history', answered: 50, correct: 40, tier: 0 }],
  knowledge: { facts: 120, total: 3250 },
  recent: [
    {
      matchId: 'm1',
      mode: 'duel',
      endedAt: Date.now() - 60_000,
      placement: 1,
      players: 2,
      score: 1500,
      correct: 8,
      questions: 10,
      xp: 120,
      ratingDelta: 14,
    },
  ],
  achievements: [],
  seasons: [],
  ...more,
});

const show = (username = 'Мария') =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ProfileView username={username} />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  setState({ me: { id: 7, username: 'Ана', isGuest: false, xp: 100 } as never, friendsVersion: 0, game: null });
});

test('another player: the numbers, the modes with the rank, a friend request sent', async () => {
  jest
    .spyOn(api, 'profile')
    .mockResolvedValueOnce(profile())
    .mockResolvedValue(profile({ friendship: 'outgoing' }));
  const add = jest.spyOn(api, 'addFriend').mockResolvedValue({ friends: [], incoming: [], outgoing: [] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await show();
  await waitFor(() => expect(screen.getByText('Мария')).toBeTruthy());
  expect(screen.getByLabelText('Точност: 75%, 300 от 400 верни')).toBeTruthy();
  expect(screen.getByText('Злато')).toBeTruthy();
  expect(screen.getByLabelText('История (Познавач): 80%, 40 от 50 верни')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Настройки' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Добави приятел' }));
  expect(add).toHaveBeenCalledWith('Мария');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Поканата е изпратена' })).toBeTruthy());
});

test('a report: a reason first, then sent with the details', async () => {
  jest.spyOn(api, 'profile').mockResolvedValue(profile());
  const report = jest.spyOn(api, 'report').mockResolvedValue({ ok: true } as never);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await show();
  await waitFor(() => expect(screen.getByText('Мария')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: '🚩 Докладвай' }));
  const send = screen.getByRole('button', { name: 'Изпрати доклад' });
  expect(send.props.accessibilityState?.disabled).toBe(true);
  await fireEvent.press(screen.getByRole('radio', { name: 'Обидно поведение' }));
  await fireEvent.changeText(screen.getByLabelText('Подробности (по желание)'), '  обиди в чата  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Изпрати доклад' }));
  expect(report).toHaveBeenCalledWith('Мария', 'behavior', 'обиди в чата');
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Благодарим!', expect.any(String)));
});

test('a block asks first, and the profile then offers to unblock', async () => {
  jest
    .spyOn(api, 'profile')
    .mockResolvedValueOnce(profile())
    .mockResolvedValue(profile({ blocked: true }));
  const block = jest.spyOn(api, 'block').mockResolvedValue({ players: [] });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await show();
  await waitFor(() => expect(screen.getByText('Мария')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: '🚫 Блокирай' }));
  expect(block).not.toHaveBeenCalled();
  const buttons = alert.mock.calls.at(-1)?.[2] ?? [];
  await act(async () => {
    await buttons.find((b) => b.text === 'Блокирай')?.onPress?.();
  });
  expect(block).toHaveBeenCalledWith(9);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Отблокирай' })).toBeTruthy());
  // Blocked, no friend request either way.
  expect(screen.queryByRole('button', { name: 'Добави приятел' })).toBeNull();
});

test('your own profile: Settings, and „Моите знания“ from its number', async () => {
  setState({ me: { id: 9, username: 'Мария', isGuest: false, xp: 2400 } as never });
  jest.spyOn(api, 'profile').mockResolvedValue(profile());
  await show();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Настройки' })).toBeTruthy());
  expect(screen.queryByRole('button', { name: '🚩 Докладвай' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Научени факти: 120, от 3250' }));
  expect(router.navigate).toHaveBeenCalledWith('/knowledge');
});

test('a name nobody has: the server’s word, no „Опитай пак“', async () => {
  const { ApiError } = jest.requireActual('@almanac/client');
  jest.spyOn(api, 'profile').mockRejectedValue(new ApiError('Няма такъв играч', 404));
  await show('никой');
  await waitFor(() => expect(screen.getByText('Няма такъв играч')).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Опитай пак' })).toBeNull();
});
