// Challenge links and friend duels: a link accepted and shared, a duel played, a lost one's rematch on your ground.
import { actions, api, setState } from '@almanac/client';
import type { ChallengeInfo, DuelEntry, DuelStanding, PublicUser } from '@almanac/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ChallengeScreen from '@/app/c/[id]';
import { DuelList } from '@/duels/parts';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'abc123' }),
  useFocusEffect: jest.fn(),
}));

const user = (id: number, username: string) =>
  ({ id, username, avatar: 'fox', frame: 'classic', title: 'spark', level: 5 }) as unknown as PublicUser;
const maria = user(9, 'Мария');
const HOUR = 3_600_000;

const challenge = (more: Partial<ChallengeInfo> = {}): ChallengeInfo => ({
  id: 'abc123',
  creator: maria,
  createdAt: Date.now() - HOUR,
  expiresAt: Date.now() + 20 * HOUR,
  questions: 10,
  entries: [{ rank: 1, user: maria, score: 1450, correct: 8, timeMs: 41_000, you: false }],
  total: 1,
  attempted: false,
  expired: false,
  duelOnly: false,
  duel: null,
  ...more,
});

const standing = (more: Partial<DuelStanding> = {}): DuelStanding => ({
  friend: maria,
  mine: null,
  theirs: { score: 1200, correct: 7, timeMs: 50_000 },
  outcome: null,
  record: { wins: 2, losses: 3, draws: 0 },
  expiresAt: Date.now() + 20 * HOUR,
  expired: false,
  canPick: false,
  ...more,
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
  setState({
    me: { id: 7, username: 'Ана', isGuest: false, moreTime: 'off', unreadNotifications: 0 } as never,
    friendsVersion: 0,
    game: null,
  });
});

test('a link: the score to beat, accepted, and shared with its address', async () => {
  jest.spyOn(api, 'challenge').mockResolvedValue(challenge());
  const start = jest.spyOn(actions, 'startChallenge').mockResolvedValue({ ok: true, id: 'm1' });
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  await show(<ChallengeScreen />);
  await waitFor(() => expect(screen.getByText('Мария те предизвиква')).toBeTruthy());
  // The score to beat, and the board's first row.
  expect(screen.getAllByText('1450 т.')).toHaveLength(2);
  expect(screen.getByLabelText('1-во място: Мария, 1450 т., 8 от 10 верни за 41,0 с')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Приеми предизвикателството' }));
  expect(start).toHaveBeenCalledWith('abc123');
  await fireEvent.press(screen.getByRole('button', { name: 'Сподели линка' }));
  expect(share.mock.calls[0]?.[0].message).toMatch(/Можеш ли да биеш 1450 точки\?\nhttps:\/\/almanac\.bg\/c\/abc123$/);
});

test('a link played: your place, and no second try', async () => {
  jest.spyOn(api, 'challenge').mockResolvedValue(
    challenge({
      attempted: true,
      total: 2,
      entries: [
        { rank: 1, user: maria, score: 1450, correct: 8, timeMs: 41_000, you: false },
        { rank: 2, user: user(7, 'Ана'), score: 900, correct: 6, timeMs: 60_000, you: true },
      ],
    }),
  );
  await show(<ChallengeScreen />);
  await waitFor(() => expect(screen.getByText('Твоят резултат')).toBeTruthy());
  expect(screen.getByText(/2-ро място от 2/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Приеми предизвикателството' })).toBeNull();
});

test('a link nobody has: it says so, and offers one of your own', async () => {
  const { ApiError } = jest.requireActual('@almanac/client');
  jest.spyOn(api, 'challenge').mockRejectedValue(new ApiError('Няма такова предизвикателство', 404));
  await show(<ChallengeScreen />);
  await waitFor(() => expect(screen.getByText('Линкът не работи')).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Създай предизвикателство' })).toBeTruthy();
});

test('a duel your turn: both sides, and played from its card', async () => {
  jest
    .spyOn(api, 'challenge')
    .mockResolvedValue(challenge({ duelOnly: true, duel: { ...standing(), creatorId: 9 }, entries: [], total: 1 }));
  const start = jest.spyOn(actions, 'startChallenge').mockResolvedValue({ ok: true, id: 'm1' });
  await show(<ChallengeScreen />);
  await waitFor(() => expect(screen.getByText('Ти срещу Мария')).toBeTruthy());
  expect(screen.getByText(/^Твой ред · остават/)).toBeTruthy();
  expect(screen.getByLabelText('Мария: 1200 т., 7 от 10 верни')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Играй дуела' }));
  expect(start).toHaveBeenCalledWith('abc123');
});

test('a duel lost: the rematch on your ground, three categories in order', async () => {
  const lost = standing({
    mine: { score: 800, correct: 5, timeMs: 60_000 },
    outcome: 'lost',
    canPick: true,
  });
  jest
    .spyOn(api, 'challenge')
    .mockResolvedValue(
      challenge({ duelOnly: true, attempted: true, duel: { ...lost, creatorId: 9 }, entries: [], total: 2 }),
    );
  const duel = jest.spyOn(actions, 'startDuel').mockResolvedValue({ ok: true, id: 'next' });
  await show(<ChallengeScreen />);
  await waitFor(() => expect(screen.getByText('Загуба')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: '↻ Реванш' }));
  const play = () => screen.getByRole('button', { name: /^Играй \(\d\/3\)$/ });
  expect(play().props.accessibilityState?.disabled).toBe(true);
  for (const name of ['История', 'Наука', 'География']) await fireEvent.press(screen.getByRole('checkbox', { name }));
  expect(screen.getByRole('checkbox', { name: 'Наука, рунд 2' })).toBeTruthy();
  await fireEvent.press(play());
  expect(duel).toHaveBeenCalledWith(9, ['history', 'science', 'geography']);
});

test('the duels list: whose turn, and „Играй“ plays it', async () => {
  const start = jest.spyOn(actions, 'startChallenge').mockResolvedValue({ ok: true, id: 'm1' });
  const duels: DuelEntry[] = [
    { ...standing(), id: 'd1', createdAt: Date.now(), state: 'yours' },
    {
      ...standing({ mine: { score: 1500, correct: 9, timeMs: 30_000 }, outcome: 'won' }),
      id: 'd2',
      createdAt: Date.now() - HOUR,
      state: 'done',
    },
  ];
  await show(<DuelList duels={duels} />);
  expect(screen.getByRole('link', { name: /^Дуел с Мария: твой ред, 1200 т\. за биене/ })).toBeTruthy();
  expect(screen.getByText('Победа · 1500 : 1200')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Играй' }));
  expect(start).toHaveBeenCalledWith('d1');
});
