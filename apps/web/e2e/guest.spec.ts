import { expect, expectLobby, me, playMatch, startSolo, test } from './support';

test('a newcomer plays a first solo match as a guest', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/АЛМАНАХ/);
  await page.getByRole('button', { name: 'Играй като гост', exact: true }).click();

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
