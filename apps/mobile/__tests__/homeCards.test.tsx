// Играй's cards: the evening Роял, the day's quests, a challenge link, „Поправителен“ ready, the address nudge, what a
// rank means, and the newcomer's way in.
import { actions, api, setState } from '@almanac/client';
import type { EveningInfo } from '@almanac/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ChallengeCard } from '@/home/ChallengeCard';
import { EveningCard } from '@/home/EveningCard';
import { Modes } from '@/home/Modes';
import { EmailNudge, ReviewTurn } from '@/home/Nudges';
import { QuestsCard } from '@/home/QuestsCard';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));

const MIN = 60_000;
const me = {
  id: 7,
  username: 'Ана',
  avatar: 'fox',
  xp: 1200,
  isGuest: false,
  email: null,
  pendingEmail: null,
  stats: { games: 12, wins: 5, answered: 120, correct: 80 },
  ratings: { duel: 1130 },
  knowledge: { facts: 40, due: 6 },
  unreadNotifications: 0,
  quests: {
    day: '2026-11-03',
    endsAt: Date.now() + 5 * 3_600_000,
    bonusXp: 60,
    bonusDone: false,
    quests: [
      { id: 'q1', icon: '🎯', text: 'Отговори вярно на 20 въпроса', goal: 20, progress: 12, xp: 40, done: false },
      { id: 'q2', icon: '🔥', text: 'Серия от 5 верни', goal: 5, progress: 5, xp: 30, done: true },
    ],
  },
};

const evening = (more: Partial<NonNullable<EveningInfo['status']>> = {}): EveningInfo => ({
  status: {
    day: '2026-11-03',
    startsAt: Date.now() + 3 * MIN,
    opensAt: Date.now() - 2 * MIN,
    waiting: 7,
    joined: false,
    live: false,
    ...more,
  },
  lastNight: {
    day: '2026-11-02',
    players: 31,
    top: [
      { placement: 1, user: { id: 9, username: 'Мария', avatar: 'owl' } as never, score: 9100 },
      { placement: 2, user: { id: 3, username: 'Петър', avatar: 'cat' } as never, score: 8700 },
    ],
  },
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
  setState({ me: me as never, evening: null, connected: true, lobby: null, queue: null, friendsVersion: 0 });
});

test('the evening Роял with its door open: how many wait, „Влез“, and last night’s top', async () => {
  jest.spyOn(api, 'evening').mockResolvedValue(evening());
  const join = jest.spyOn(actions, 'joinEvening').mockResolvedValue({ ok: true });
  await show(<EveningCard />);
  await waitFor(() =>
    expect(screen.getByText(/^Входът е отворен · 7 чакат · започва след (2:5\d|3:00)$/)).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Влез' }));
  expect(join).toHaveBeenCalled();
  expect(screen.queryByText('Петър')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: /Снощи/ }));
  expect(screen.getByText('Петър')).toBeTruthy();
});

test('the evening Роял the rest of the day: a quiet line, no clock', async () => {
  jest
    .spyOn(api, 'evening')
    .mockResolvedValue(
      evening({ startsAt: Date.now() + 9 * 3_600_000, opensAt: Date.now() + 8.9 * 3_600_000, waiting: 0 }),
    );
  await show(<EveningCard compact />);
  await waitFor(() => expect(screen.getByText(/^Всяка вечер в \d\d:\d\d, до 50 души\./)).toBeTruthy());
  expect(screen.queryByText(/ · след /)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Влез' })).toBeNull();
});

test('the day’s quests: each with its progress said, the done one marked, and the bonus', async () => {
  await show(<QuestsCard />);
  expect(screen.getByText('1/2 изпълнени')).toBeTruthy();
  expect(screen.getByLabelText('Отговори вярно на 20 въпроса: 12 от 20, +40 XP')).toBeTruthy();
  expect(screen.getByLabelText('Серия от 5 верни: 5 от 5, изпълнена, +30 XP')).toBeTruthy();
  expect(screen.getByText('Изпълни и трите за бонус')).toBeTruthy();
});

test('a challenge link: one made at once; yours listed with who leads, a tap opens it', async () => {
  jest.spyOn(api, 'myChallenges').mockResolvedValue({
    challenges: [
      {
        id: 'abc',
        createdAt: Date.now() - 3_600_000,
        expiresAt: Date.now() + 6 * 86_400_000,
        players: 3,
        myScore: 1200,
        leader: { username: 'Мария', score: 1500 },
      } as never,
    ],
  });
  const start = jest.spyOn(actions, 'startChallenge').mockResolvedValue({ ok: true, id: 'new' });
  await show(<ChallengeCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Създай предизвикателство' }));
  expect(start).toHaveBeenCalledWith();
  await waitFor(() => expect(screen.getByText('Мария води с 1500 т.')).toBeTruthy());
  await fireEvent.press(screen.getByRole('link', { name: /^Мария води с 1500 т\., 3 играчи/ }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/c/[id]', params: { id: 'abc' } });
});

test('„Поправителен“ ready: how many it plays, a tap away', async () => {
  const start = jest.spyOn(actions, 'startReview').mockResolvedValue({ ok: true });
  await show(<ReviewTurn />);
  expect(screen.getByText(/6 въпроса за нов опит/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Играй Поправителен' }));
  expect(start).toHaveBeenCalled();
});

test('no address yet, a few matches in: the nudge, hidden for good with ✕', async () => {
  await show(<EmailNudge />);
  await waitFor(() => expect(screen.getByText(/Добави имейл, за да можеш/)).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'Скрий' }));
  expect(screen.queryByText(/Добави имейл, за да можеш/)).toBeNull();
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('almanac.email-nudge', '1');
});

test('a ranked tile’s „?“: what the rank means, yours marked', async () => {
  jest.spyOn(api, 'friends').mockResolvedValue({ friends: [], incoming: [], outgoing: [] });
  setState({ lobby: { online: 30, inGame: 12, queues: { duel: 2 }, modes: ['duel'], build: null } as never });
  await show(<Modes />);
  expect(screen.getByText('12 играят в момента')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Рейтинг и рангове в „Дуел“' }));
  expect(screen.getByText('Рейтинг и рангове')).toBeTruthy();
  expect(screen.getByLabelText(/^Сребро \(ти\): от 1100/)).toBeTruthy();
});

test('a newcomer is pointed at the duel', async () => {
  setState({
    me: { ...me, xp: 0 } as never,
    lobby: { online: 3, inGame: 1, queues: {}, modes: ['duel'], build: null } as never,
  });
  await show(<Modes />);
  expect(screen.getByRole('button', { name: /^Дуел \(започни оттук\)/ })).toBeTruthy();
  expect(screen.queryByText(/играят в момента/)).toBeNull();
  await act(async () => {});
});
