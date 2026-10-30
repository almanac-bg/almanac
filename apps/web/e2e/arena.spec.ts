import { expect, gameMs, playMatch, startAsGuest, test } from './support';

test('Арена: filled to three (bots for whoever is missing), played to the end, three places', async ({ page }) => {
  await startAsGuest(page);
  await page.getByRole('button', { name: 'Играй Арена', exact: true }).click();
  await expect(page).toHaveURL(/\/game$/);

  // Nobody else waits: bots take the seats (BOT_FILL_SECONDS), up to the three Арена needs.
  const counter = page.getByText(/^Въпрос \d+ от \d+$/);
  await expect(counter).toBeVisible({ timeout: gameMs(20_000) });
  // In three rounds (playMatch picks when it's the player's turn). The number final comes from a category no round
  // had: the public sample's few numbers don't always leave one, so it isn't counted on here.
  const { answered, total } = await playMatch(page);
  expect(answered).toBe(total);

  // Three on the podium: the player and two bots (or others who queued at the same moment: a test run repeated).
  await expect(page.getByRole('list', { name: 'Класиране', exact: true }).getByRole('listitem')).toHaveCount(3);
});
