import { expect, test } from './support';

/**
 * The installed app's service worker (public/sw.js): a page that can't be fetched shows the game's own page instead
 * of the browser's — „Няма връзка“ without a connection, and „Сървърът не отговаря“ when Cloudflare answers for a
 * server that's down (520–530), where its own page is in English (the 31 October review, CF-4). Both try again by
 * themselves. Chromium only: there the tests can stand in for the network the worker fetches from.
 */
test.skip(({ browserName }) => browserName !== 'chromium', 'routing a service worker’s requests is Chromium’s');

test('a page the network can’t give shows the game’s own: no connection, or a server that’s down', async ({
  page,
  context,
  pageProblems,
}) => {
  await page.goto('/');
  // Installed and in charge of the page (it claims it as it activates).
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // Cloudflare's answer for a server it can't reach.
  await context.route('**/rules', (route) =>
    route.fulfill({
      status: 521,
      headers: { server: 'cloudflare', 'content-type': 'text/html' },
      body: '<h1>Web server is down</h1>',
    }),
  );
  await page.goto('/rules');
  await expect(page.getByRole('heading', { name: 'Сървърът не отговаря' })).toBeVisible();
  await expect(page.getByText('Връщаме се след малко')).toBeVisible();
  await expect(page).toHaveTitle('Сървърът не отговаря — АЛМАНАХ');
  await expect(page.getByText('Web server is down')).toHaveCount(0);
  // It tries again by itself, as the page without a connection does.
  await expect(page.locator('meta[http-equiv="refresh"]')).toHaveAttribute('content', '15');

  // Another server's 52x (not Cloudflare's) is passed on as it is.
  await context.unroute('**/rules');
  await context.route('**/rules', (route) =>
    route.fulfill({ status: 522, headers: { 'content-type': 'text/html' }, body: '<h1>Something else</h1>' }),
  );
  await page.goto('/rules');
  await expect(page.getByRole('heading', { name: 'Something else' })).toBeVisible();

  // No connection at all.
  await context.unroute('**/rules');
  await context.setOffline(true);
  await page.reload().catch(() => {});
  await expect(page.getByRole('heading', { name: 'Няма връзка' })).toBeVisible();
  await expect(page).toHaveTitle('Няма връзка — АЛМАНАХ');
  await context.setOffline(false);
  // The browser's word for each failed load above, and nothing else.
  const expected = (p: string) =>
    /^console: Failed to load resource: (the server responded with a status of 5\d\d|net::ERR_INTERNET_DISCONNECTED)/.test(
      p,
    );
  pageProblems.splice(0, pageProblems.length, ...pageProblems.filter((p) => !expected(p)));
});
