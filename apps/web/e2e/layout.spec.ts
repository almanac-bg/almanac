import {
  expect,
  expectLobby,
  expectNoSideScroll,
  type Page,
  playMatch,
  signUp,
  startSolo,
  test,
  uniqueName,
} from './support';

/**
 * Nothing on the main screens may be wider than the screen (a page that scrolls sideways on a phone is broken):
 * the landing page, the lobby, a results screen and Settings, each at every size.
 */
async function checkScreens(page: Page, sizes: { width: number; height: number }[]) {
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Играй като гост', exact: true }).first()).toBeVisible();
    await expectNoSideScroll(page, `landing page at ${size.width}px`);
  }

  await page.getByRole('button', { name: 'Играй като гост', exact: true }).first().click();
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

// A request's card holds a name and two buttons: on a narrow phone the buttons go under the name.
test('a friend request waiting fits the friends page on a 320 px phone', async ({ page, newPlayer }) => {
  const anna = uniqueName('Анна');
  await signUp(page, anna, 'parola-123');
  const boris = await newPlayer();
  await signUp(boris, uniqueName('Борис'), 'parola-123');
  await boris.goto('/friends');
  await boris.getByLabel('Потребителско име на приятел', { exact: true }).fill(anna);
  await boris.getByRole('button', { name: 'Добави', exact: true }).click();
  await expect(boris.getByText('Поканата е изпратена')).toBeVisible();

  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 640 });
    await page.goto('/friends');
    await expect(page.getByRole('button', { name: 'Приеми', exact: true })).toBeVisible();
    await expectNoSideScroll(page, `friends page with a request at ${width}px`);
  }
  await page.getByRole('button', { name: 'Приеми', exact: true }).click();
  await expect(page.getByText('Вече сте приятели!')).toBeVisible();
});

// Playwright clicks only what a person could click: a link under an invisible layer fails here.
test('the legal links on the landing page open the legal pages', async ({ page }) => {
  for (const size of [
    { width: 375, height: 812 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(size);
    for (const [name, heading] of [
      ['Условия за ползване', 'Условия за ползване'],
      ['Политика за поверителност', 'Политика за поверителност'],
    ]) {
      await page.goto('/');
      await page.getByRole('link', { name, exact: true }).click();
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
  }
});

// A mistyped link says so — signed out it isn't the sign-up form, signed in it isn't a silent jump home.
test('a wrong address shows "page not found", signed out and signed in', async ({ page, pageProblems }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Тази страница не съществува', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Страницата не съществува — АЛМАНАХ');
  await signUp(page, uniqueName('Изгубен'), 'parola-123');
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Тази страница не съществува', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Към началото', exact: true }).click();
  await expectLobby(page);
  // The browser logs the 404 itself: that's the point of this test, not a problem.
  const expected = (p: string) => p.includes('status of 404') && p.includes('/no-such-page');
  pageProblems.splice(0, pageProblems.length, ...pageProblems.filter((p) => !expected(p)));
});
