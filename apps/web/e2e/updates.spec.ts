import type { WebSocketRoute } from '@playwright/test';
import { expect, startAsGuest, test } from './support';

// The app's service worker answers file requests from its cache in some engines, out of page.route()'s sight: here
// every download goes over the network, where the tests decide how it ends.
test.use({ serviceWorkers: 'block' });

/**
 * WebKit (Playwright's build 2370) keeps a module that failed to load for the rest of the tab's life, reloads
 * included: only a new tab fetches it again. A real deploy renames every file whose code changed, so a reload then asks
 * for new names; what stays stuck is a file that failed under the same name (one asked for in the seconds the app
 * restarts). To check on a real iPhone.
 */
const WEBKIT_KEEPS_FAILED_MODULES = 'WebKit keeps a failed module for the tab, even across reloads';

/** The legal pages' code: loaded only when asked for (pages/lazy.ts → ON_REQUEST), so a test controls its download. */
const LEGAL_CODE = /\/assets\/LegalPages-[^/]+\.js$/;

/**
 * The browser's own complaints about a download a test failed on purpose, in each engine's words, and React's report
 * of the error it then caught (Firefox shows that as a bare "Error" or "JSHandle@object" from React's file; #520 and
 * #422 are React drawing the page itself when the server-drawn one couldn't hydrate without its code): expected.
 */
function forgive(problems: string[]) {
  const expected = (p: string) =>
    /LegalPages|dynamically imported module|Importing a module script failed|Failed to load resource|MIME type|#520|#422/.test(
      p,
    ) || /^console: (Error|JSHandle@object) \(.*\/assets\/react-[^/]+\.js\)$/.test(p);
  problems.splice(0, problems.length, ...problems.filter((p) => !expected(p)));
}

test('a deploy mid-session: the server says so, the tab comes back to the new one, and old code is fetched anew', async ({
  page,
  pageProblems,
  browserName,
}) => {
  test.fixme(browserName === 'webkit', WEBKIT_KEEPS_FAILED_MODULES);
  // Every realtime connection goes through here, so the test can play the server's side of a restart.
  const links: { page: WebSocketRoute; server: WebSocketRoute }[] = [];
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    links.push({ page: ws, server: ws.connectToServer() });
  });
  await startAsGuest(page);

  // The server starts draining for the restart (realtime.ts → drain): everyone hears why new matches wait…
  const notice = 'Обновяваме играта — връщаме се след минута.';
  links.at(-1)!.page.send(`42${JSON.stringify(['server:draining', { message: notice }])}`);
  await expect(page.getByText(notice)).toBeVisible();
  // …then it stops, and the tab finds the new server by itself (at a random moment in the first 5 s).
  const old = links.at(-1)!;
  await Promise.all([old.page.close(), old.server.close()]);
  await expect(page.locator('[data-connection="down"]')).toHaveCount(1);
  await expect(page.locator('[data-connection="up"]')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByText(notice)).toBeHidden();

  // The new build names its files anew: a page whose code this tab hasn't loaded yet asks for the old file, which is
  // gone. One reload, and the page comes from the new build.
  let asked = 0;
  await page.route(LEGAL_CODE, (route) =>
    // As the server answers a file a deploy took away (never to be kept: apps/server/src/index.ts).
    asked++ === 0
      ? route.fulfill({ status: 404, headers: { 'cache-control': 'no-store' }, body: '' })
      : route.continue(),
  );
  await page.getByRole('link', { name: 'Настройки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  const reloaded = page.waitForEvent('load');
  await page.getByRole('link', { name: 'Политиката за поверителност', exact: true }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: 'Политика за поверителност', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/privacy$/);
  expect(asked).toBe(2);
  forgive(pageProblems);
});

test('a page whose code won’t download: one reload to fetch it again, then a way out, never a loop', async ({
  page,
  pageProblems,
  browserName,
}) => {
  await page.goto('/');
  // What a file request gets while the app restarts for a deploy: Caddy's "updating" page (deploy/Caddyfile), not code.
  await page.route(LEGAL_CODE, (route) =>
    route.fulfill({
      status: 503,
      headers: { 'cache-control': 'no-store', 'retry-after': '10', 'content-type': 'text/html; charset=utf-8' },
      body: '<!doctype html><title>Обновяваме АЛМАНАХ</title>',
    }),
  );
  let loads = 0;
  page.on('load', () => loads++);
  await page.getByRole('link', { name: 'Политика за поверителност', exact: true }).first().click();
  // Said in the page, as what it is (not a bug of ours): the rest of the app stays.
  await expect(page.getByRole('heading', { name: 'Страницата не се зареди', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  // A moment more: no second reload comes.
  await page.waitForTimeout(1_500);
  expect(loads, 'reloaded once to try again').toBe(1);

  // The deploy is through: „Опитай пак“ asks for the page anew. WebKit keeps a module that failed to load for the
  // page's life, so there the way out is the reload, home, and from there the page opens in a new tab only.
  await page.unroute(LEGAL_CODE);
  if (browserName !== 'webkit') {
    await page.getByRole('button', { name: 'Опитай пак', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Политика за поверителност', exact: true })).toBeVisible();
  } else {
    await page.getByRole('button', { name: 'Презареди', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  }
  forgive(pageProblems);
});
