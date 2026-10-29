import { expect, gameMs, startAsGuest, test } from './support';

// The only test that queues for Роял: bots fill its seats a second after it joins.
test('Роял through an elimination: knocked out at the first cut, the player gets the last place and when it ended', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await startAsGuest(page);
  await page.getByRole('button', { name: 'Играй Роял', exact: true }).click();
  await expect(page).toHaveURL(/\/game$/);
  await expect(page.getByText(/^Въпрос 1 от \d+$/)).toBeVisible({ timeout: gameMs(15_000) });

  // Not a single answer: the lowest score goes at the first knockout, after question 4. With only bots left, the rest
  // is decided at once (GamePage says so for the moment it takes), and the results come.
  await expect(page.getByRole('heading', { name: 'Награди', exact: true })).toBeVisible({ timeout: gameMs(90_000) });
  await expect(page.getByText('Отпадна след въпрос 4', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '8-мо място', exact: true })).toBeVisible();
});
