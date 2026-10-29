import { expect, expectLobby, me, playMatch, startAsGuest, startSolo, test } from './support';

test('a newcomer plays a first solo match as a guest', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/АЛМАНАХ/);
  await page.getByRole('button', { name: 'Играй като гост', exact: true }).first().click();

  await expectLobby(page);
  await expect(page.getByRole('heading', { name: 'Задачи за деня', exact: true })).toBeVisible();
  const guest = await me(page);
  expect(guest).toMatchObject({ isGuest: true, xp: 0 });

  await startSolo(page, 'География');
  expect(await playMatch(page)).toEqual({ answered: 10, total: 10 });

  await expect(page.getByText('Соло · География')).toBeVisible();
  await expect(page.getByText(/точки · \d+ от 10 верни/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Награди', exact: true })).toBeVisible();
  // The XP is the guest's already (on the server), and the screen offers to keep it with a name and password.
  expect((await me(page)).xp).toBeGreaterThan(0);
  await expect(page.getByText(/^Запази тези [\d\s]+ XP/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Запази прогреса', exact: true })).toBeVisible();
});

test('results open at the top, however far down the lobby was when the match began', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Играй като гост', exact: true }).first().click();
  await expectLobby(page);
  // Дуел sits below the first screen on a phone: the lobby is scrolled to reach it.
  const duel = page.getByRole('button', { name: 'Играй Дуел', exact: true });
  await duel.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 150));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await duel.click();
  await expect(page).toHaveURL(/\/game$/);
  await playMatch(page);
  await expect(page.getByRole('heading', { name: 'Награди', exact: true })).toBeAttached();
  // The browser restored the lobby's scroll a moment after the results drew: give it that moment.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('a first match levels up: the new level comes first, on its own, then the results', async ({ page }) => {
  await startAsGuest(page);
  await startSolo(page, 'Микс');
  await playMatch(page, { moment: 'keep' });
  const moment = page.getByRole('dialog', { name: 'Ново от този мач', exact: true });
  await expect(moment).toBeVisible();
  await expect(moment.getByText('Ново ниво', { exact: true })).toBeVisible();
  // A beat at a time (the level, then any avatar or frame it brought), to the page: each step leaves before the next
  // comes in, and the last one's button (still on show while the dialog fades) is pressed once.
  for (let beat = 0; ; beat++) {
    expect(beat, 'never got to the results').toBeLessThan(6);
    const button = moment.getByRole('button', { name: /^(Нататък|Към резултата)$/ });
    const last = (await button.textContent()) === 'Към резултата';
    const step = await button.elementHandle();
    await button.click();
    if (last) break;
    await step!.waitForElementState('hidden');
  }
  await expect(moment).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Награди', exact: true })).toBeVisible();
});
