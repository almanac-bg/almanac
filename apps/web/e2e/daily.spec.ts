import { expect, me, playMatch, test } from './support';

test("a newcomer's first tap plays the day's questions; a duel is the next thing to try", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Играй въпросите на деня', exact: true }).first().click();
  await expect(page).toHaveURL(/\/game$/);
  expect(await playMatch(page)).toEqual({ answered: 10, total: 10 });

  await expect(page.getByText('Въпросите на деня', { exact: true }).first()).toBeVisible();
  // A guest is off the day's board, and sees where it would stand on it.
  await expect(page.getByRole('heading', { name: 'Щеше да си днес', exact: true })).toBeVisible();
  expect((await me(page)).isGuest).toBe(true);
  await expect(page.getByRole('button', { name: 'Играй Дуел', exact: true })).toBeVisible();
});

test("a friend opens someone's daily link, plays the same questions and sees how they did against them", async ({
  page,
  newPlayer,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Играй въпросите на деня', exact: true }).first().click();
  await playMatch(page);
  const sharer = await me(page);
  const link = await page.request.post('/api/daily/link');
  expect(link.ok()).toBe(true);
  const { code } = (await link.json()) as { code: string };

  // Signed out, from a chat app.
  const friend = await newPlayer();
  await friend.goto(`/daily/${code}`);
  await expect(friend.getByRole('heading', { name: `${sharer.username} те кани`, exact: true })).toBeVisible();
  await friend.getByRole('button', { name: 'Играй', exact: true }).click();
  await expect(friend).toHaveURL(/\/game$/);
  expect(await playMatch(friend)).toEqual({ answered: 10, total: 10 });
  await expect(friend.getByText(`По линка на ${sharer.username}`)).toBeVisible();

  // The sharer hears how it went.
  await expect
    .poll(async () => {
      const res = await page.request.get('/api/daily');
      return ((await res.json()) as { fromMyLink: unknown[] }).fromMyLink.length;
    })
    .toBe(1);
});
