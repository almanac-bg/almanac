// After a match: the headline and what changed, who placed where (a friend added from there), the rewards, the day's
// standing and its link, a challenge link's place, a duel's rematch — and the next step at the bottom, by the mode.
import { actions, api, type LiveGame, setState } from '@almanac/client';
import type { GameEndPayload, GamePlayer, MatchRewards } from '@almanac/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Share } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Results } from '@/game/Results';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() } }));

const player = (id: string, name: string, more: Partial<GamePlayer> = {}): GamePlayer =>
  ({
    id,
    userId: Number(id.slice(1)),
    name,
    avatar: 'fox',
    frame: 'classic',
    title: 'spark',
    level: 4,
    isBot: false,
    isGuest: false,
    rating: null,
    team: null,
    ...more,
  }) as GamePlayer;

const rewards = (more: Partial<MatchRewards> = {}): MatchRewards =>
  ({
    xpGained: 180,
    breakdown: [
      { label: 'Верни отговори', amount: 100 },
      { label: 'Победа', amount: 50 },
      { label: 'Бързина', amount: 20 },
      { label: 'Серия', amount: 6 },
      { label: 'Задача', amount: 4 },
    ],
    xpBefore: 1000,
    xpAfter: 1180,
    levelBefore: 4,
    levelAfter: 4,
    achievements: [],
    unlocks: [],
    rating: null,
    unrated: null,
    daily: null,
    challenge: null,
    soloBest: null,
    knowledge: { added: 2 },
    mastery: [],
    ...more,
  }) as MatchRewards;

const finished = (
  mode: GameEndPayload['mode'],
  end: Partial<GameEndPayload>,
  more: Partial<LiveGame> = {},
): LiveGame => {
  const players = more.start?.players ?? [player('u1', 'Ана')];
  return {
    ...more,
    start: {
      gameId: 'g1',
      mode,
      pace: 'normal',
      category: 'history',
      youId: 'u1',
      players,
      roomCode: null,
      questionSet: null,
      totalQuestions: 10,
      timeMs: 15_000,
      eliminationSchedule: [],
      powerups: [],
      emotes: [],
      teams: false,
      ...more.start,
    },
    players: Object.fromEntries(players.map((p) => [p.id, p])),
    history: [
      {
        id: 'q1',
        index: 0,
        q: 'Коя е столицата?',
        options: ['София', 'Пловдив'],
        correct: 0,
        choice: 0,
        right: true,
        fact: 'Столица от 1879 г.',
      },
      {
        id: 'q2',
        index: 1,
        q: 'Колко са планетите?',
        options: ['7', '8'],
        correct: 1,
        choice: 0,
        right: false,
        fact: null,
      },
    ],
    phase: 'ended',
    end: {
      gameId: 'g1',
      mode,
      ranked: false,
      roomCode: null,
      standings: [{ id: 'u1', score: 1200, streak: 0, correct: 7, placement: 1, eliminatedAt: null, left: false }],
      teamScores: null,
      rewards: rewards(),
      noContest: false,
      ...end,
    } as GameEndPayload,
  } as unknown as LiveGame;
};

const show = (game: LiveGame) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <Results game={game} />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  setState({
    me: { id: 1, username: 'Ана', avatar: 'fox', frame: 'classic', isGuest: false, knowledge: { due: 0 } } as never,
    room: null,
    friendsVersion: 0,
  });
});

test('Соло: the headline, the XP and its biggest lines, then another one and a share', async () => {
  const solo = jest.spyOn(actions, 'startSolo').mockResolvedValue({ ok: true });
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  await show(finished('solo', { rewards: rewards({ soloBest: 900 }) }));
  expect(screen.getByText('Готово!')).toBeTruthy();
  expect(screen.getByText('Соло · История')).toBeTruthy();
  expect(screen.getByText('🏆 Нов личен рекорд! (беше 900)')).toBeTruthy();
  expect(screen.getByText('Верни отговори')).toBeTruthy();
  expect(screen.queryByText('Задача')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '+ още 2 реда' }));
  expect(screen.getByText('Задача')).toBeTruthy();
  expect(screen.getByText('💡 Днес научи')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '↻ Играй пак' }));
  expect(solo).toHaveBeenCalledWith('history', 'normal');
  await fireEvent.press(screen.getByRole('button', { name: 'Сподели резултата' }));
  expect(share.mock.calls[0]?.[0].message).toMatch(/^🏵️ АЛМАНАХ\n🎯 1\/10 в „История“/);
});

test('a Дуел won: the rating, the podium with „+ Приятел“, and the rating card', async () => {
  jest.spyOn(api, 'friends').mockResolvedValue({ friends: [], incoming: [], outgoing: [] });
  const add = jest.spyOn(api, 'addFriend').mockResolvedValue({ friends: [], incoming: [], outgoing: [] });
  const players = [player('u1', 'Ана'), player('u9', 'Мария')];
  await show(
    finished(
      'duel',
      {
        ranked: true,
        standings: [
          { id: 'u1', score: 1500, streak: 0, correct: 8, placement: 1, eliminatedAt: null, left: false },
          { id: 'u9', score: 1100, streak: 0, correct: 6, placement: 2, eliminatedAt: null, left: false },
        ] as never,
        rewards: rewards({ rating: { before: 1240, after: 1262 } }),
      },
      { start: { players } as never },
    ),
  );
  expect(screen.getByText('Победа!')).toBeTruthy();
  expect(screen.getByText('Рейтинг 1262 (+22)')).toBeTruthy();
  expect(screen.getByLabelText('1-во място: Ана (ти), 1500 т.')).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Добави Мария за приятел' })).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'Добави Мария за приятел' }));
  expect(add).toHaveBeenCalledWith('Мария');
  expect(screen.getByText('Нов ранг!')).toBeTruthy();
});

test('the day’s questions: the place, the link to send, and the day’s board next', async () => {
  jest.spyOn(api, 'dailyLink').mockResolvedValue({ code: 'x7Kp2q' });
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  await show(
    finished('daily', {
      rewards: rewards({
        daily: {
          rank: 4,
          total: 23,
          offBoard: false,
          streak: 5,
          shieldsUsed: 0,
          shieldEarned: true,
          sharer: null,
          field: null,
        },
      }),
    }),
  );
  expect(screen.getByText('Денят е изигран')).toBeTruthy();
  expect(screen.getByText('Имаш нов щит!')).toBeTruthy();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Прати днешните въпроси' }).props.accessibilityState?.disabled,
    ).toBeFalsy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Прати днешните въпроси' }));
  expect(share.mock.calls[0]?.[0].message).toMatch(/https:\/\/almanac\.bg\/daily\/x7Kp2q$/);
  await fireEvent.press(screen.getByRole('button', { name: '📊 Класация за деня' }));
  expect(router.replace).toHaveBeenCalledWith('/leaderboard');
});

test('a challenge link played first: the bar is set, and the link goes out from its card', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  await show(
    finished('challenge', {
      rewards: rewards({ challenge: { id: 'abc123', rank: 1, total: 1, duel: null } as never }),
    }),
  );
  expect(screen.getByText('Летвата е поставена!')).toBeTruthy();
  expect(screen.getByText('Сега прати линка')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Сподели линка' }));
  expect(share.mock.calls[0]?.[0].message).toMatch(/1200 точки на 10 въпроса.*\nhttps:\/\/almanac\.bg\/c\/abc123$/s);
  // A link is shared from its card, not the bar.
  expect(screen.queryByRole('button', { name: 'Сподели резултата' })).toBeNull();
});

test('a friend duel lost: the duel, and the rematch in the bar', async () => {
  const duel = {
    friend: { id: 9, username: 'Мария', avatar: 'owl', frame: 'classic' },
    mine: { score: 900, correct: 6, timeMs: 1 },
    theirs: { score: 1300, correct: 8, timeMs: 1 },
    outcome: 'lost',
    record: { wins: 1, losses: 2, draws: 0 },
    expiresAt: Date.now() + 3_600_000,
    expired: false,
    canPick: false,
  };
  const again = jest.spyOn(actions, 'startDuel').mockResolvedValue({ ok: true, id: 'd2' });
  await show(
    finished('challenge', { rewards: rewards({ challenge: { id: 'd1', rank: 2, total: 2, duel } as never }) }),
  );
  expect(screen.getByRole('heading', { name: 'Загуба' })).toBeTruthy();
  expect(screen.getByText('Дуел с Мария')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '↻ Реванш' }));
  expect(again).toHaveBeenCalledWith(9, undefined);
});

test('a team match: the winners named, both teams with their totals', async () => {
  const players = [
    player('u1', 'Ана', { team: 0 }),
    player('u9', 'Мария', { team: 0 }),
    player('b1', 'Бот', { team: 1, isBot: true, userId: null }),
    player('b2', 'Бот 2', { team: 1, isBot: true, userId: null }),
  ];
  jest.spyOn(api, 'friends').mockResolvedValue({ friends: [], incoming: [], outgoing: [] });
  await show(
    finished(
      'teams',
      {
        teamScores: [
          { team: 0, score: 2400 },
          { team: 1, score: 1800 },
        ],
        standings: players.map((p, i) => ({
          id: p.id,
          score: 1200 - i * 100,
          streak: 0,
          correct: 5,
          placement: i + 1,
          eliminatedAt: null,
          left: false,
        })) as never,
      },
      { start: { players } as never },
    ),
  );
  expect(screen.getByText('Победа!')).toBeTruthy();
  expect(screen.getByText('Сините печелят!')).toBeTruthy();
  expect(screen.getByText('2400')).toBeTruthy();
  // Отбори starts from a friend's yes: the way on is Играй.
  expect(screen.getByRole('button', { name: 'Към началото' })).toBeTruthy();
});
