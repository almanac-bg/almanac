// Приятели: a request accepted, a friend challenged to a Дуел, a name added — and a guest pointed to saving the account.
import { actions, api, setState } from '@almanac/client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Friends from '@/app/(tabs)/friends';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));

const user = (id: number, username: string) => ({ id, username, avatar: 'fox', frame: 'classic' }) as never;
const list = {
  friends: [{ user: user(2, 'Мария'), presence: 'online' as const, since: Date.now() }],
  incoming: [{ user: user(3, 'Петър'), presence: 'offline' as const, since: Date.now() }],
  outgoing: [],
};

const show = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <Friends />
    </SafeAreaProvider>,
  );

test('a request accepted, and a friend challenged to a Дуел', async () => {
  setState({ me: { id: 7, username: 'Ана', isGuest: false } as never, friendsVersion: 0, game: null });
  jest.spyOn(api, 'friends').mockResolvedValue(list);
  const accept = jest.spyOn(api, 'acceptFriend').mockResolvedValue({ ...list, incoming: [] });
  const duel = jest.spyOn(actions, 'startDuel').mockResolvedValue({ ok: true, id: 'c1' });
  await show();
  await waitFor(() => expect(screen.getByText('Мария')).toBeTruthy());
  expect(screen.getByText('Онлайн')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Приеми' }));
  expect(accept).toHaveBeenCalledWith(3);
  await waitFor(() => expect(screen.queryByText('Петър')).toBeNull());
  await fireEvent.press(screen.getByRole('button', { name: 'Дуел' }));
  expect(duel).toHaveBeenCalledWith(2);
});

test('a name added sends the request, and says so', async () => {
  setState({ me: { id: 7, username: 'Ана', isGuest: false } as never, friendsVersion: 1 });
  jest.spyOn(api, 'friends').mockResolvedValue({ ...list, incoming: [] });
  const add = jest.spyOn(api, 'addFriend').mockResolvedValue({ ...list, incoming: [] });
  await show();
  await fireEvent.changeText(screen.getByLabelText('Добави приятел по потребителско име'), 'Иван');
  await fireEvent.press(screen.getByRole('button', { name: 'Изпрати покана' }));
  expect(add).toHaveBeenCalledWith('Иван');
  await waitFor(() => expect(screen.getByText('Поканата до Иван е изпратена.')).toBeTruthy());
});

test('a guest is pointed to saving the account first', async () => {
  setState({ me: { id: 9, username: 'Гост_1', isGuest: true } as never });
  await show();
  expect(screen.getByText(/Приятелите са за играчи с профил/)).toBeTruthy();
});
