// Класации: the boards load as they're picked, the top three get their medals, and you're there even off the list.
import { api, setState } from '@almanac/client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Leaderboard from '@/app/(tabs)/leaderboard';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

const user = (id: number, username: string) => ({ id, username, avatar: 'fox', frame: 'classic' });
const me = { ...user(7, 'Ана'), isGuest: false, createdAt: 0, daily: { day: '2026-11-03', played: true, streak: 2 } };

const leaderboard = jest.spyOn(api, 'leaderboard').mockImplementation(async (board) => ({
  board,
  entries: [
    { rank: 1, user: user(1, 'Иван') as never, value: board === 'level' ? 90_000 : 9_100, correct: 10 },
    { rank: 2, user: user(2, 'Мария') as never, value: 80_000, correct: 9 },
  ],
  me: { rank: 41, user: user(7, 'Ана') as never, value: 12_000, correct: 6 },
  season: null,
}));

const show = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <Leaderboard />
    </SafeAreaProvider>,
  );

test('the level board: the leaders with their medals, and you below them with your place', async () => {
  setState({ me: me as never, lobby: null });
  await show();
  await waitFor(() => expect(screen.getByLabelText('1. Иван: 90 000 XP')).toBeTruthy());
  expect(screen.getByText('🥇')).toBeTruthy();
  expect(screen.getByLabelText('41. Ти: 12 000 XP')).toBeTruthy();
});

test('picking the day’s board loads it, with how many were right', async () => {
  setState({ me: me as never, lobby: null });
  await show();
  await fireEvent.press(screen.getByRole('radio', { name: 'Днес' }));
  await waitFor(() => expect(leaderboard).toHaveBeenLastCalledWith('daily'));
  await waitFor(() => expect(screen.getByLabelText('1. Иван: 9100 т. · 10/10')).toBeTruthy());
});
