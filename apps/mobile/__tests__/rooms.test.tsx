// Private rooms: one made from Играй, the lobby for the host (bots, settings, the door, the start) and for a player,
// joining by code (a guest says their room name first, a locked room keeps you at its door), a friend's invitation.
import { actions, setState, useStore } from '@almanac/client';
import type { Invite, PublicUser, RoomPlayer, RoomState } from '@almanac/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Join from '@/app/join/[code]';
import Room from '@/app/room';
import { TopOverlays } from '@/components/TopOverlays';
import { RoomsCard } from '@/home/RoomsCard';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
  Redirect: () => null,
  useLocalSearchParams: () => ({ code: '123456' }),
}));

const player = (id: string, name: string, more: Partial<RoomPlayer> = {}): RoomPlayer =>
  ({
    id,
    name,
    avatar: 'fox',
    frame: 'classic',
    title: 'spark',
    level: 3,
    isBot: false,
    isGuest: false,
    team: null,
    isHost: false,
    ...more,
  }) as RoomPlayer;

const room = (more: Partial<RoomState> = {}): RoomState => ({
  code: '123456',
  hostId: 'u7',
  settings: {
    maxPlayers: 8,
    questions: 10,
    timeMs: 15_000,
    category: 'mixed',
    rounds: false,
    final: true,
    pictures: false,
    elimination: false,
    teams: false,
    hostPlays: true,
    set: null,
  },
  players: [player('u7', 'Ана', { isHost: true })],
  inGame: false,
  locked: false,
  knocking: [],
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
    me: { id: 7, username: 'Ана', isGuest: true } as never,
    room: null,
    knock: null,
    invites: [],
    game: null,
    connected: true,
    settled: true,
    friendsVersion: 0,
  });
});

test('Играй: a room made opens it; a code typed goes to its door', async () => {
  setState({ me: { id: 7, username: 'Ана', isGuest: false } as never });
  const create = jest.spyOn(actions, 'createRoom').mockResolvedValue({ ok: true, code: '123456' } as never);
  await show(<RoomsCard />);
  await fireEvent.press(screen.getByRole('button', { name: '+ Създай стая' }));
  expect(create).toHaveBeenCalled();
  await waitFor(() => expect(router.push).toHaveBeenCalledWith('/room'));
  const join = screen.getByRole('button', { name: 'Влез в стаята' });
  expect(join.props.accessibilityState?.disabled).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('Код на стая'), '12-34 56');
  await fireEvent.press(screen.getByRole('button', { name: 'Влез в стаята' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/join/[code]', params: { code: '123456' } });
});

test('the host’s lobby: a bot to start with, a setting changed, the start', async () => {
  setState({ me: { id: 7, username: 'Ана', isGuest: true } as never, room: room() });
  const bot = jest.spyOn(actions, 'roomBot').mockImplementation(() => ({}) as never);
  const settings = jest.spyOn(actions, 'roomSettings').mockImplementation(() => ({}) as never);
  const start = jest.spyOn(actions, 'startRoom').mockResolvedValue({ ok: true });
  await show(<Room />);
  expect(screen.getByLabelText('Код 1 2 3 4 5 6')).toBeTruthy();
  // Alone: the start waits for someone.
  expect(screen.getByText('Покани приятел или добави бот, за да започнеш.')).toBeTruthy();
  expect(screen.getByRole('button', { name: '▶ Започни' }).props.accessibilityState?.disabled).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: '🤖 Добави бот' }));
  expect(bot).toHaveBeenCalledWith('add');
  await fireEvent.press(screen.getByRole('radio', { name: '20 с' }));
  expect(settings).toHaveBeenCalledWith({ timeMs: 20_000 });
  await act(async () =>
    setState({
      room: room({ players: [player('u7', 'Ана', { isHost: true }), player('b1', 'Бот Боби', { isBot: true })] }),
    }),
  );
  await fireEvent.press(screen.getByRole('button', { name: '▶ Започни' }));
  expect(start).toHaveBeenCalled();
});

test('the host’s door: a knock let in; a guest removed asks first, and can be locked out too', async () => {
  const guest = player('g5', 'Иван 7Б', { isGuest: true });
  setState({
    room: room({
      players: [player('u7', 'Ана', { isHost: true }), guest],
      knocking: [{ id: 'g9', name: 'Петя', isGuest: true }],
    }),
  });
  const admit = jest.spyOn(actions, 'roomAdmit').mockResolvedValue({ ok: true });
  const kick = jest.spyOn(actions, 'roomKick').mockImplementation(() => ({}) as never);
  const lock = jest.spyOn(actions, 'roomLock').mockImplementation(() => ({}) as never);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await show(<Room />);
  await fireEvent.press(screen.getByRole('button', { name: 'Пусни Петя' }));
  expect(admit).toHaveBeenCalledWith('g9', true);
  await fireEvent.press(screen.getByRole('button', { name: 'Премахни Иван 7Б' }));
  expect(kick).not.toHaveBeenCalled();
  const buttons = alert.mock.calls.at(-1)?.[2] ?? [];
  await act(async () => buttons.find((b) => b.text === 'Премахни и заключи')?.onPress?.());
  expect(kick).toHaveBeenCalledWith('g5');
  expect(lock).toHaveBeenCalledWith(true);
});

test('a player’s lobby: the settings shown, not changed; waiting for the host', async () => {
  setState({
    me: { id: 8, username: 'Мария', isGuest: true } as never,
    room: room({ players: [player('u7', 'Ана', { isHost: true }), player('u8', 'Мария')] }),
  });
  const settings = jest.spyOn(actions, 'roomSettings').mockImplementation(() => ({}) as never);
  await show(<Room />);
  expect(screen.getByText('Чакаме домакина да започне…')).toBeTruthy();
  expect(screen.getByText('Само домакинът ги променя')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '▶ Започни' })).toBeNull();
  expect(screen.getByRole('radio', { name: '20 с' }).props.accessibilityState?.disabled).toBe(true);
  expect(settings).not.toHaveBeenCalled();
});

test('joining by code: a guest gives a room name first; once in, the room', async () => {
  const join = jest.spyOn(actions, 'joinRoom').mockResolvedValue({ ok: true } as never);
  await show(<Join />);
  await fireEvent.press(screen.getByRole('button', { name: 'Влез в стаята' }));
  expect(join).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Име в стаята'), '  Иван   7Б ');
  await fireEvent.press(screen.getByRole('button', { name: 'Влез в стаята' }));
  expect(join).toHaveBeenCalledWith('123456', 'Иван 7Б');
  await act(async () => setState({ room: room() }));
  expect(router.replace).toHaveBeenCalledWith('/room');
});

test('joining a locked room: at its door until the host decides', async () => {
  setState({ me: { id: 7, username: 'Ана', isGuest: false } as never, knock: { code: '123456', refused: null } });
  jest.spyOn(actions, 'joinRoom').mockResolvedValue({ ok: true } as never);
  await show(<Join />);
  expect(screen.getByText('Чакаш домакина')).toBeTruthy();
  await act(async () => setState({ knock: { code: '123456', refused: 'Домакинът не те пусна.' } }));
  expect(screen.getByText('Не влезе в стаята')).toBeTruthy();
  expect(screen.getByText('Домакинът не те пусна.')).toBeTruthy();
});

test('a friend’s invitation into a room: in, and the room opens', async () => {
  const from = { id: 9, username: 'Мария', avatar: 'fox', frame: 'classic' } as unknown as PublicUser;
  const invite: Invite = { id: 'r1', from, roomCode: '654321', kind: 'room', expiresAt: Date.now() + 60_000 };
  const join = jest.spyOn(actions, 'joinRoom').mockResolvedValue({ ok: true } as never);
  setState({ invites: [invite] });
  await show(<TopOverlays signedIn />);
  expect(screen.getByText(/те кани в стая\./)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Влез в стаята на Мария' }));
  expect(join).toHaveBeenCalledWith('654321');
  await waitFor(() => expect(router.push).toHaveBeenCalledWith('/room'));
  expect(useStore.getState().invites).toHaveLength(0);
});
