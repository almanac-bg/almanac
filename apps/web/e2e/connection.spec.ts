import type { WebSocketRoute } from '@playwright/test';
import { expect, playMatch, startAsGuest, startSolo, test } from './support';

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
