// Over every screen: the client's toasts (said as they come, gone after their time or a tap) and a friend's
// invitation to Отбори; and Отбори's own sheet, asking a friend who's online.
import { actions, api, setState, toast, useStore } from '@almanac/client';
import type { Invite, PublicUser } from '@almanac/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TopOverlays } from '@/components/TopOverlays';
import { DuoSheet } from '@/home/DuoSheet';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));

const user = (id: number, username: string) =>
  ({ id, username, avatar: 'fox', frame: 'classic', title: 'spark', level: 5 }) as unknown as PublicUser;

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
    me: { id: 7, username: 'Ана', isGuest: false } as never,
    toasts: [],
    invites: [],
    game: null,
    friendsVersion: 0,
  });
});

test('a toast is said as it comes, and goes after its time — or at a tap', async () => {
  jest.useFakeTimers();
  const said = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  await show(<TopOverlays signedIn />);
  await act(async () => toast({ kind: 'success', icon: '🏆', title: 'Ново постижение: Първа победа', body: '+50 XP' }));
  expect(screen.getByText('Ново постижение: Първа победа')).toBeTruthy();
  expect(said).toHaveBeenCalledWith('Ново постижение: Първа победа. +50 XP');
  await act(async () => jest.advanceTimersByTime(4600));
  expect(screen.queryByText('Ново постижение: Първа победа')).toBeNull();
  await act(async () => toast({ kind: 'info', title: 'Реваншът няма да се състои.' }));
  await fireEvent.press(screen.getByRole('alert', { name: 'Реваншът няма да се състои.' }));
  expect(useStore.getState().toasts).toHaveLength(0);
  jest.useRealTimers();
});

test('a friend’s invitation to Отбори: yes plays, no declines; none over a match', async () => {
  const invite: Invite = {
    id: 'i1',
    from: user(9, 'Мария'),
    roomCode: null,
    kind: 'duo',
    expiresAt: Date.now() + 60_000,
  };
  const accept = jest.spyOn(actions, 'acceptDuo').mockResolvedValue({ ok: true });
  const decline = jest.spyOn(actions, 'declineInvite').mockImplementation(() => {});
  setState({ invites: [invite] });
  await show(<TopOverlays signedIn />);
  expect(screen.getByText(/те кани за Отбори/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Откажи' }));
  expect(decline).toHaveBeenCalledWith(invite);
  await fireEvent.press(screen.getByRole('button', { name: 'Играй Отбори с Мария' }));
  expect(accept).toHaveBeenCalledWith('i1');
  await waitFor(() => expect(useStore.getState().invites).toHaveLength(0));
  // Over a match it waits.
  setState({ invites: [invite], game: { phase: 'question' } as never });
  expect(screen.queryByText(/те кани за Отбори/)).toBeNull();
});

test('Отбори’s sheet: the friends who are on first, an invitation to one, the offline ones not askable', async () => {
  jest.spyOn(api, 'friends').mockResolvedValue({
    friends: [
      { user: user(3, 'Петър'), presence: 'offline', since: 0 },
      { user: user(9, 'Мария'), presence: 'online', since: 0 },
    ],
    incoming: [],
    outgoing: [],
  });
  const invite = jest.spyOn(actions, 'inviteDuo').mockResolvedValue({ ok: true });
  await show(<DuoSheet open onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Покани Мария' })).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Покани Петър' }).props.accessibilityState?.disabled).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'Покани Мария' }));
  expect(invite).toHaveBeenCalledWith(9);
  await waitFor(() => expect(screen.getByText('✓ Поканата е пратена')).toBeTruthy());
});
