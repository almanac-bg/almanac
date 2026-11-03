// The apps' claim to the site's links (8o; the 31 October review, MOBILE-8): the app paths become the patterns Apple's
// and Android's checks read, and the two files say which apps may open them.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { APP_PATHS, appLinkPatterns, routeKind } from '@almanac/shared';
import { startServer, type TestServer } from './helpers';

const T = { timeout: 60_000 };
const PRINT = Array.from({ length: 32 }, (_, i) => (i * 7).toString(16).padStart(2, '0').toUpperCase()).join(':');

let srv: TestServer;
before(async () => {
  srv = await startServer({
    IOS_APP_ID: 'ABCDE12345.bg.almanac.app',
    ANDROID_PACKAGE: 'bg.almanac.app',
    ANDROID_CERT_SHA256: PRINT,
  });
});
after(() => srv?.stop());

/** A pattern as the stores read it: `*` is any characters. */
const matches = (pattern: string, path: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`).test(path);

test("every screen the app has is in its links, and none it hasn't", () => {
  const patterns = appLinkPatterns();
  assert.ok(patterns.includes('/c/*'), 'a friend duel, the link people share most');
  assert.ok(patterns.includes('/join/*') && patterns.includes('/daily'));
  for (const pattern of patterns)
    assert.equal(routeKind(pattern.replaceAll('*', 'x')), 'app', `${pattern} is a screen of the game`);
  for (const path of ['/admin', '/class', '/reset-password', '/verify-email', '/unsubscribe', '/', '/privacy', '/quiz'])
    assert.ok(!patterns.some((p) => matches(p, path)), `${path} stays the web's`);
  // Each app path is reached: its regex's examples match some pattern.
  for (const { path, app } of APP_PATHS.filter((p) => p.app)) {
    const example = path.source
      .replace(/^\^|\$$/g, '')
      .replace(/\(.*\)\?$/, '')
      .replaceAll('\\/', '/')
      .replaceAll('[^/]+', 'x');
    assert.ok(app && patterns.some((p) => matches(p, example)), `${path} has a pattern`);
  }
});

test('Apple reads which iOS app opens the links, and whose passwords are the site’s', T, async () => {
  const res = await fetch(`${srv.url}/.well-known/apple-app-site-association`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const body = (await res.json()) as {
    applinks: { details: { appIDs: string[]; components: { '/': string }[] }[] };
    webcredentials: { apps: string[] };
  };
  assert.deepEqual(body.applinks.details[0].appIDs, ['ABCDE12345.bg.almanac.app']);
  assert.deepEqual(
    body.applinks.details[0].components.map((c) => c['/']),
    appLinkPatterns(),
  );
  assert.deepEqual(body.webcredentials.apps, ['ABCDE12345.bg.almanac.app']);
});

test('Google reads which Android app, signed by which certificate', T, async () => {
  const res = await fetch(`${srv.url}/.well-known/assetlinks.json`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), [
    {
      relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
      target: { namespace: 'android_app', package_name: 'bg.almanac.app', sha256_cert_fingerprints: [PRINT] },
    },
  ]);
});
