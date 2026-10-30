import type { WebSocketRoute } from '@playwright/test';
import { expect, playMatch, signUp, startAsGuest, startSolo, test, uniqueName } from './support';

test('a connection that drops mid-match comes back to the same match, which plays to the end', async ({ page }) => {
  // Every realtime connection goes through here, so the test can cut one the way a tunnel or a lift would.
  const links: { page: WebSocketRoute; server: WebSocketRoute }[] = [];
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    links.push({ page: ws, server: ws.connectToServer() });
  });
  await startAsGuest(page);
  await startSolo(page, 'Микс');

  // The first question answered, then the line goes.
  await page
    .getByRole('button', { name: /^[АБВГ]\) /, disabled: false })
    .first()
    .click();
  await expect(page.getByRole('button', { name: /— (верен отговор, )?твоят избор/ })).toBeVisible();
  const cut = links.at(-1)!;
  await Promise.all([cut.page.close(), cut.server.close()]);
  await expect(page.locator('[data-connection="down"]')).toHaveCount(1);

  // Back on a new connection, in the same match: the other nine questions, then the results.
  await expect(page.locator('[data-connection="up"]')).toHaveCount(1, { timeout: 10_000 });
  expect(links.length).toBeGreaterThan(1);
  expect(await playMatch(page)).toEqual({ answered: 9, total: 10 });
  await expect(page.getByRole('heading', { name: 'Награди', exact: true })).toBeVisible();
});

test('the back button during a match asks first, and pressed again keeps playing', async ({ page }) => {
  await startAsGuest(page);
  await startSolo(page, 'Микс');
  await expect(page.getByRole('button', { name: /^[АБВГ]\) / }).first()).toBeVisible();

  const asking = page.getByRole('dialog', { name: 'Да напуснеш ли мача?', exact: true });
  await page.goBack();
  await expect(asking).toBeVisible();
  await expect(page).toHaveURL(/\/game$/);
  // Back again: the question goes away (as it does on Android), the match stays.
  await page.goBack();
  await expect(asking).toBeHidden();
  await expect(page).toHaveURL(/\/game$/);

  // And leaving for real lands in the lobby, with no match left running.
  await page.goBack();
  await asking.getByRole('button', { name: 'Напусни', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Избери битка', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Мачът тече/ })).toHaveCount(0);
});

test('a blip or a reload on /room keeps the player in the room the server kept for them', async ({ page }) => {
  const links: { page: WebSocketRoute; server: WebSocketRoute }[] = [];
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    links.push({ page: ws, server: ws.connectToServer() });
  });
  await signUp(page, uniqueName('stayer'), 'tajna-parola-1');
  await page.getByRole('button', { name: /^Създай (своя )?стая$/ }).click();
  await expect(page).toHaveURL(/\/room$/);
  const room = page.getByRole('heading', { name: 'Частна стая', exact: true });
  await expect(room).toBeVisible();

  // The line goes and comes back: still in the room, never through the lobby.
  const cut = links.at(-1)!;
  await Promise.all([cut.page.close(), cut.server.close()]);
  await expect(page.locator('[data-connection="up"]')).toHaveCount(1, { timeout: 10_000 });
  await page.waitForTimeout(3_000); // past the moment a room not sent again would be dropped
  await expect(page).toHaveURL(/\/room$/);
  await expect(room).toBeVisible();

  // A reload too.
  await page.reload();
  await expect(room).toBeVisible();
  await expect(page).toHaveURL(/\/room$/);
});

// The service worker would carry the request past the test's stand-in for the server (in WebKit).
test.describe('without the service worker', () => {
  test.use({ serviceWorkers: 'block' });
  test('a start-up that can’t ask the server who’s signed in keeps asking, rather than show the signed-out page', async ({
    page,
    pageProblems,
  }) => {
    await startAsGuest(page);
    // What the server answers while it restarts for a deploy, twice.
    let refused = 0;
    await page.route('**/api/me', (route) =>
      refused++ < 2 ? route.fulfill({ status: 503, body: '' }) : route.continue(),
    );
    await page.goto('/leaderboard');
    await expect(page.getByText('Свързваме се със сървъра…')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Играй като гост' })).toHaveCount(0);
    // Then it answers: the page the player opened, signed in as before.
    await expect(page.getByRole('heading', { name: 'Класации', exact: true })).toBeVisible({ timeout: 10_000 });
    expect(refused).toBeGreaterThanOrEqual(3);
    // The browser's own line for each refused request: expected.
    pageProblems.splice(
      0,
      pageProblems.length,
      ...pageProblems.filter((p) => !/status of 503|Failed to load resource/.test(p)),
    );
  });
});
