// The day's questions by their address (a friend's link, the streak's reminder) — and an address the app has no screen
// for, which says so and opens the site.
import { actions, api, setState } from '@almanac/client';
import type { DailyInfo } from '@almanac/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { Share } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import NotFound from '@/app/+not-found';
import { DailyScreen } from '@/daily/DailyScreen';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
  usePathname: () => '/groups/k7b',
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));

const info = (more: Partial<DailyInfo> = {}): DailyInfo =>
  ({
    day: '2026-11-03',
    number: 42,
    endsAt: Date.now() + 5 * 3_600_000,
    total: 31,
    attempted: false,
    played: null,
    offBoard: false,
    fromMyLink: [],
    ...more,
  }) as DailyInfo;

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
    me: {
      id: 1,
      username: 'Ана',
      isGuest: false,
      moreTime: 'off',
      createdAt: 0,
      daily: { day: '2026-11-03', played: false },
    } as never,
  });
});

test('a friend’s link: whose result to beat, and the day played with their code', async () => {
  jest.spyOn(api, 'daily').mockResolvedValue(info());
  jest.spyOn(api, 'dailyPreview').mockResolvedValue({
    sharer: { user: { id: 9, username: 'Мария', avatar: 'owl', frame: 'classic' }, score: 1400, correct: 8 },
  } as never);
  const start = jest.spyOn(actions, 'startDaily').mockResolvedValue({ ok: true });
  await show(<DailyScreen code="x7Kp2q" />);
  await waitFor(() => expect(screen.getByText('Мария те кани')).toBeTruthy());
  expect(screen.getByText(/№42 · 3 ноември/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Играй днешните →' }));
  expect(start).toHaveBeenCalledWith('x7Kp2q');
});

test('the day played: the result and place, and your link to send', async () => {
  jest
    .spyOn(api, 'daily')
    .mockResolvedValue(info({ attempted: true, played: { score: 1250, correct: 7, rank: 4, field: null } as never }));
  jest.spyOn(api, 'dailyLink').mockResolvedValue({ code: 'mine1' });
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  await show(<DailyScreen code={null} />);
  await waitFor(() => expect(screen.getByText('Твоят резултат днес')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'Прати днешните въпроси' }));
  await waitFor(() =>
    expect(share.mock.calls[0]?.[0].message).toBe('🏵️ АЛМАНАХ №42 · 7/10\n1250 т.\nhttps://almanac.bg/daily/mine1'),
  );
});

test('an address the app has no screen for: said so, and the site a tap away', async () => {
  await show(<NotFound />);
  expect(screen.getByText('Това е на сайта')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Отвори на сайта' }));
  expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://almanac.bg/groups/k7b');
});
