// Групи: one made by its name, a group's week (the board, who hasn't played, past winners) with its owner's buttons, and
// an invite link opened — joined, or straight in when you're a member already.
import { api, setState } from '@almanac/client';
import type { GroupInfo, PublicUser } from '@almanac/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert, Share } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Group from '@/app/groups/[id]';
import Groups from '@/app/groups/index';
import GroupInvite from '@/app/groups/join/[code]';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: '5', code: 'k7b' }),
}));

const user = (id: number, username: string) =>
  ({ id, username, avatar: 'fox', frame: 'classic', title: 'spark', level: 3 }) as unknown as PublicUser;

const group = (more: Partial<GroupInfo> = {}): GroupInfo => ({
  id: 5,
  name: 'Клас 7б',
  code: 'k7b',
  owner: user(1, 'Ана'),
  isOwner: true,
  members: 3,
  week: {
    start: '2026-11-02',
    endsAt: Date.now() + 86_400_000,
    entries: [
      { rank: 1, user: user(9, 'Мария'), score: 4200, days: 2, today: 2100, crown: true },
      { rank: 2, user: user(1, 'Ана'), score: 3100, days: 2, today: null, crown: false },
    ],
    waiting: [user(3, 'Петър')],
  },
  history: [{ week: '2026-10-26', winner: user(9, 'Мария'), score: 9800 }],
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
  setState({ me: { id: 1, username: 'Ана', isGuest: false, daily: { played: false }, groups: 1 } as never });
});

test('a group made by its name (too short says so first), then opened', async () => {
  jest.spyOn(api, 'groups').mockResolvedValue({ groups: [] });
  const create = jest.spyOn(api, 'createGroup').mockResolvedValue({ id: 5 });
  await show(<Groups />);
  await waitFor(() => expect(screen.getByText('Още не си в група')).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('Име на групата'), 'К');
  await fireEvent.press(screen.getByRole('button', { name: 'Създай' }));
  expect(create).not.toHaveBeenCalled();
  expect(screen.getByText('Името е твърде кратко: поне 2 знака.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Име на групата'), 'Клас 7б');
  await fireEvent.press(screen.getByRole('button', { name: 'Създай' }));
  expect(create).toHaveBeenCalledWith('Клас 7б');
  await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/groups/[id]', params: { id: '5' } }));
});

test('a group’s week: the board with last week’s crown, who hasn’t played, the invite sent, a member removed', async () => {
  jest.spyOn(api, 'group').mockResolvedValue(group());
  const removeFrom = jest.spyOn(api, 'removeFromGroup').mockResolvedValue(group({ members: 2 }));
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await show(<Group />);
  await waitFor(() =>
    expect(screen.getByLabelText('1. миналата седмица победител, Мария: 4200 т., 2 дни, днес изигран')).toBeTruthy(),
  );
  expect(screen.getByText('Още не са играли')).toBeTruthy();
  expect(screen.getByText('👑 Мария · 9800 т.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Прати линка' }));
  expect(share.mock.calls[0]?.[0].message).toMatch(/„Клас 7б“.*\nhttps:\/\/almanac\.bg\/groups\/join\/k7b$/s);
  // The owner can't remove themselves.
  expect(screen.queryByRole('button', { name: 'Премахни Ана от групата' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Премахни Петър от групата' }));
  await act(async () =>
    alert.mock.calls
      .at(-1)?.[2]
      ?.find((b) => b.text === 'Премахни')
      ?.onPress?.(),
  );
  expect(removeFrom).toHaveBeenCalledWith(5, 3);
});

test('a member’s view: no owner’s buttons, a report on the name instead', async () => {
  jest.spyOn(api, 'group').mockResolvedValue(group({ isOwner: false }));
  await show(<Group />);
  await waitFor(() => expect(screen.getByRole('button', { name: '🚩 Сигнал за името' })).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Изтрий групата' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Нов линк' })).toBeNull();
});

test('an invite link: joined, and the group opens; a member already goes straight there', async () => {
  const preview = jest
    .spyOn(api, 'groupPreview')
    .mockResolvedValue({ name: 'Клас 7б', members: 3, owner: 'Ана', memberOf: null, full: false });
  const join = jest.spyOn(api, 'joinGroup').mockResolvedValue({ id: 5 });
  await show(<GroupInvite />);
  await waitFor(() => expect(screen.getByText('Клас 7б')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'Влез в групата' }));
  expect(join).toHaveBeenCalledWith('k7b');
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/groups/[id]', params: { id: '5' } }));
  preview.mockResolvedValue({ name: 'Клас 7б', members: 3, owner: 'Ана', memberOf: 5, full: false });
  jest.clearAllMocks();
  await show(<GroupInvite />);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/groups/[id]', params: { id: '5' } }));
});
