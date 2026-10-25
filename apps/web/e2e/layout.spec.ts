import { expect, expectLobby, expectNoSideScroll, type Page, playMatch, startSolo, test } from './support';

/**
 * Nothing on the main screens may be wider than the screen (a page that scrolls sideways on a phone is broken):
 * the landing page, the lobby, a results screen and Settings, each at every size.
 */
async function checkScreens(page: Page, sizes: { width: number; height: number }[]) {
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Играй като гост', exact: true })).toBeVisible();
    await expectNoSideScroll(page, `landing page at ${size.width}px`);
  }

  await page.getByRole('button', { name: 'Играй като гост', exact: true }).click();
  await expectLobby(page);
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto('/');
    await expectLobby(page);
    await expect(page.getByRole('heading', { name: 'Задачи за деня', exact: true })).toBeVisible();
    await expectNoSideScroll(page, `lobby at ${size.width}px`);

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
    await expectNoSideScroll(page, `Settings at ${size.width}px`);
  }

  // One match; its results screen then goes through every size (it can't be reloaded: it lives in the page).
  await page.goto('/');
  await expectLobby(page);
  await startSolo(page, 'Микс');
  await playMatch(page);
  for (const size of sizes) {
    await page.setViewportSize(size);
    await expect(page.getByRole('heading', { name: 'Награди', exact: true })).toBeVisible();
    await expectNoSideScroll(page, `results at ${size.width}px`);
  }
}

test('phones 320 and 375 px wide never scroll sideways', async ({ page }) => {
  await checkScreens(page, [
    { width: 320, height: 640 },
    { width: 375, height: 812 },
  ]);
});

test('a 1280×800 screen never scrolls sideways', { tag: '@desktop' }, async ({ page }) => {
  await checkScreens(page, [{ width: 1280, height: 800 }]);
});
