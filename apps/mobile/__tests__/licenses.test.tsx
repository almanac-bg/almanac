// Лицензи: the game's own licence and the source of the exact version that runs, then the fonts, every package in the
// app and the native libraries its builds add, each with its licence's text (src/settings/licenses.json, written from
// the bundle and native-notices/ by scripts/licenses.mjs).
import { setState } from '@almanac/client';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Licenses from '@/app/licenses';
import Settings from '@/app/settings';
import notices from '@/settings/licenses.json';
import pkg from '../package.json';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

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

beforeEach(() => jest.clearAllMocks());

test('the notices: every package with a licence and its text, the app’s own among them, and the source', () => {
  expect(notices.source).toBe('https://github.com/almanac-bg/almanac');
  expect(notices.fonts.map((f) => f.name)).toEqual(['Onest', 'Unbounded']);
  const names = notices.packages.map((p) => p.name);
  for (const used of ['react', 'react-native', 'expo', 'expo-router', 'zustand', 'socket.io-client'])
    expect(names).toContain(used);
  // Only what's in the bundle: not the tools the install brings, nor the shared code (the app's own, AGPL).
  expect(names).not.toContain('typescript');
  expect(names.some((n) => n.startsWith('@almanac/'))).toBe(false);
  for (const p of notices.packages) {
    expect(p.licence).toMatch(/\S/);
    expect(p.text.length).toBeGreaterThan(200);
  }
});

test('the native libraries the builds add: each with its licence, and Apache-2.0’s full text once, last', () => {
  const names = notices.native.map((n) => n.name);
  for (const used of ['Hermes', 'SDWebImage', 'libavif', 'Fresco', 'OkHttp', 'Glide', 'libjpeg-turbo'])
    expect(names).toContain(used);
  for (const n of notices.native) {
    expect(n.licence).toMatch(/\S/);
    expect(n.platforms).toMatch(/^(iOS|Android|iOS, Android)$/);
    expect(n.text.length).toBeGreaterThan(100);
  }
  const apache = notices.native.filter((n) => n.text.includes('TERMS AND CONDITIONS FOR USE'));
  expect(apache.at(-1)?.name).toBe('Apache License 2.0 (пълният текст)');
  // Every other Apache-2.0 notice without the text in it points to that one.
  for (const n of notices.native.filter((n) => n.licence.includes('Apache-2.0') && !apache.includes(n)))
    expect(n.text).toContain('„Apache License 2.0 (пълният текст)“');
  // libjpeg-turbo's IJG part asks for this line wherever only the compiled code goes.
  expect(notices.native.find((n) => n.name === 'libjpeg-turbo')?.text).toMatch(
    /^This software is based in part on the work of the Independent JPEG Group\./,
  );
});

test('the source of this version, its licence, then a package’s licence unfolded and folded again', async () => {
  await show(<Licenses />);
  expect(screen.getByText(`АЛМАНАХ ${pkg.version}`)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: `Изходният код на версия ${pkg.version}` }));
  expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(
    `https://github.com/almanac-bg/almanac/tree/v${pkg.version}`,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Лицензът (GNU AGPL-3.0)' }));
  expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(
    `https://github.com/almanac-bg/almanac/blob/v${pkg.version}/LICENSE`,
  );
  expect(screen.getByText(`Библиотеки (${notices.packages.length})`)).toBeTruthy();
  expect(screen.getByText(`Нативни библиотеки (${notices.native.length})`)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'SDWebImage, MIT · iOS' })).toBeTruthy();

  const zustand = notices.packages.find((p) => p.name === 'zustand')!;
  const row = screen.getByRole('button', { name: `zustand, ${zustand.licence}` });
  expect(screen.queryByText(zustand.text)).toBeNull();
  await fireEvent.press(row);
  expect(screen.getByText(zustand.text)).toBeTruthy();
  expect(row.props.accessibilityState).toMatchObject({ expanded: true });
  await fireEvent.press(row);
  expect(screen.queryByText(zustand.text)).toBeNull();
});

test('Настройки: the version, and the way to the licences', async () => {
  setState({
    me: {
      id: 9,
      username: 'Ана',
      avatar: 'fox',
      xp: 300,
      isGuest: false,
      moreTime: 'off',
      shareRuns: true,
      email: null,
      pendingEmail: null,
      emailBounced: false,
      streakReminders: false,
      beatenMails: false,
    } as never,
  });
  await show(<Settings />);
  expect(screen.getByText(/^Версия .* Свободен софтуер под GNU AGPL-3\.0/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Лицензи и изходен код' }));
  expect(router.push).toHaveBeenCalledWith('/licenses');
});
