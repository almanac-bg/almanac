// Every address the app takes from the site (APP_PATHS app: true: a tapped link opens the app, not the site) has a
// screen in the app — but for the ones still to come, named here, so the gap stays in sight until the release.
import { APP_PATHS } from '@almanac/shared';
import { hasScreen } from '@/lib/links';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

/** Still on the site: until their screens come, a link to them shows „Това е на сайта“ (app/+not-found). */
const COMING: string[] = [];

/** An address an app path's expression takes: `[^/]+` as „x“, an optional part both without and with it. */
function samples(path: RegExp): string[] {
  const body = /^\^(.*)\$$/.exec(path.source)?.[1] ?? '';
  const optional = /\((.*)\)\?$/.exec(body);
  const variants = optional ? [body.slice(0, optional.index), body.slice(0, optional.index) + optional[1]] : [body];
  return variants.map((v) => v.replaceAll('\\/', '/').replaceAll('[^/]+', 'x'));
}

test('every app path has its screen, or is named as still to come', () => {
  const missing = APP_PATHS.filter((p) => p.app)
    .flatMap((p) => samples(p.path))
    .filter((path) => !hasScreen(path) && !COMING.includes(path));
  expect(missing).toEqual([]);
});

test('the ones still to come are still missing (a screen added takes its address off the list)', () => {
  expect(COMING.filter((path) => hasScreen(path))).toEqual([]);
});
