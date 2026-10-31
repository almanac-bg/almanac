import type { WebSocketRoute } from '@playwright/test';
import { expect, startAsGuest, startSolo, test } from './support';

// The app's service worker answers file requests from its cache in some engines, out of page.route()'s sight: here
// every download goes over the network, where the tests decide how it ends.
test.use({ serviceWorkers: 'block' });

/** The legal pages' code: loaded only when asked for (pages/lazy.ts → ON_REQUEST), so a test controls its download. */
const LEGAL_CODE = /\/assets\/LegalPages-[^/]+\.js$/;

/**
 * The browser's own complaints about a download a test failed on purpose, in each engine's words, and React's report
 * of the error it then caught (Firefox shows that as a bare "Error" or "JSHandle@object" from React's file; #520 and
 * #422 are React drawing the page itself when the server-drawn one couldn't hydrate without its code): expected.
 */
function forgive(problems: string[]) {
  const expected = (p: string) =>
    /LegalPages|GamePage|dynamically imported module|Importing a module script failed|Failed to load resource|MIME type|#520|#422/.test(
      p,
    ) || /^console: (Error|JSHandle@object) \(.*\/assets\/react-[^/]+\.js\)$/.test(p);
  problems.splice(0, problems.length, ...problems.filter((p) => !expected(p)));
}

test('a deploy mid-session: the server says so, the tab comes back to the new one, and old code is fetched anew', async ({
  page,
  pageProblems,
}) => {
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

  // The deploy is through: „Опитай пак“ asks for the page anew, in every engine. (WebKit once kept the failed file for
  // the tab, reloads included, because the app asked for it through <link rel="modulepreload">: vite.config.ts.)
  await page.unroute(LEGAL_CODE);
  await page.getByRole('button', { name: 'Опитай пак', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Политика за поверителност', exact: true })).toBeVisible();
  forgive(pageProblems);
});

test('a page whose code was lost while the lobby fetched it in the background still opens when it’s needed', async ({
  page,
  pageProblems,
}) => {
  // A second without a line just after the lobby appears (a lift, a switch from Wi-Fi to 4G): the match's code, which
  // the lobby fetches in the background (pages/lazy.ts → prefetchPages), doesn't arrive. In WebKit that once left the
  // tab without any match until it was closed (the 31 October review, WEB-2).
  let lost = 0;
  await page.route(/\/assets\/GamePage-[^/]+\.js$/, (route) =>
    lost++ === 0 ? route.abort('internetdisconnected') : route.continue(),
  );
  await startAsGuest(page);
  await expect.poll(() => lost, { message: 'the background fetch asked for the match’s code' }).toBeGreaterThan(0);
  await startSolo(page, 'Микс');
  await expect(page.getByText(/^Въпрос 1 от \d+$/)).toBeVisible({ timeout: 15_000 });
  forgive(pageProblems);
});
