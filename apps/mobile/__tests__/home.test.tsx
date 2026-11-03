// Играй, the home tab: who you are, the day's questions, what to play — and the search for a match. The moves go out
// through the shared client's actions, watched here.
import { actions, api, setState } from '@almanac/client';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Play from '@/app/(tabs)/index';
import { QueueOverlay } from '@/home/QueueOverlay';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

const joinQueue = jest.spyOn(actions, 'joinQueue').mockResolvedValue({ ok: true });
const startSolo = jest.spyOn(actions, 'startSolo').mockResolvedValue({ ok: true });
const startDaily = jest.spyOn(actions, 'startDaily').mockResolvedValue({ ok: true });
const leaveQueue = jest.spyOn(actions, 'leaveQueue').mockImplementation(() => {});

const me = {
  id: 7,
  username: 'Ана',
  avatar: 'fox',
  xp: 1200,
  isGuest: false,
  daily: { day: '2026-11-03', played: false, streak: 4, shields: 0 },
  stats: { games: 12, wins: 5, answered: 120, correct: 80 },
  ratings: { duel: 1130 },
  email: 'ana@example.bg',
  unreadNotifications: 0,
  knowledge: { facts: 40, due: 0 },
  quests: { day: '2026-11-03', endsAt: Date.now() + 3_600_000, quests: [], bonusXp: 50, bonusDone: false },
};

// The cards that load something of their own: nothing there today.
jest.spyOn(api, 'myChallenges').mockResolvedValue({ challenges: [] });
jest.spyOn(api, 'evening').mockResolvedValue({ status: null, lastNight: null });
jest.spyOn(api, 'duels').mockResolvedValue({ duels: [] });

beforeEach(() => {
  jest.clearAllMocks();
  setState({ me: me as never, connected: true, lobby: null, queue: null });
});

const show = (ui: React.ReactElement) =>
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

test('who you are, the day’s questions first (played before, not today), and the open ranked queues', async () => {
  await show(<Play />);
  expect(screen.getByText('Ана')).toBeTruthy();
  expect(screen.getByRole('progressbar')).toBeTruthy();
  expect(screen.getByText(/Серия 4/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Играй въпросите на деня' }));
  expect(startDaily).toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: /^Дуел: .*Рейтинг 1130/ }));
  expect(joinQueue).toHaveBeenCalledWith('duel');
});

test('Соло: a category and a pace, then the match', async () => {
  await show(<Play />);
  await fireEvent.press(screen.getByRole('button', { name: /^Соло:/ }));
  await fireEvent.press(screen.getByRole('radio', { name: /История/ }));
  await fireEvent.press(screen.getByRole('radio', { name: /^Без часовник/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Започни' }));
  expect(startSolo).toHaveBeenCalledWith('history', 'untimed');
});

test('searching for a match says how it goes, and „Откажи“ leaves the queue', async () => {
  setState({
    queue: { mode: 'duel', found: 1, needed: 2, waitedMs: 2000, botFillMs: 6000 },
    queueSince: Date.now() - 2000,
  } as never);
  await show(<QueueOverlay />);
  expect(screen.getByText('Търсим играчи…')).toBeTruthy();
  expect(screen.getByText(/играеш срещу бот или запис/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Откажи' }));
  expect(leaveQueue).toHaveBeenCalled();
});
