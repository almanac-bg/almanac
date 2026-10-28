import { expect, me, playMatch, startAsGuest, test } from './support';

// Both tests queue for a Дуел: one at a time, so they can't pair with each other's players.
test.describe.configure({ mode: 'serial' });

test('two players pressing "Играй" on Дуел together play each other', async ({ page: anna, newPlayer }) => {
  const boris = await newPlayer();
  await Promise.all([startAsGuest(anna), startAsGuest(boris)]);
  const [annaMe, borisMe] = await Promise.all([me(anna), me(boris)]);

  // The queue pairs them at once; bots would only fill the seat after a second (BOT_FILL_SECONDS).
  const play = (player: typeof anna) => player.getByRole('button', { name: 'Играй Дуел', exact: true }).click();
  await Promise.all([play(anna), play(boris)]);
  await Promise.all([anna, boris].map((player) => expect(player).toHaveURL(/\/game$/)));

  const runs = await Promise.all([playMatch(anna), playMatch(boris)]);
  expect(runs).toEqual([
    { answered: 10, total: 10 },
    { answered: 10, total: 10 },
  ]);

  for (const [player, opponent] of [
    [anna, borisMe],
    [boris, annaMe],
  ] as const) {
    // On the podium: the other person, no bot.
    await expect(player.getByText(opponent.username, { exact: true }).first()).toBeVisible();
    await expect(player.getByText('БОТ', { exact: true })).toHaveCount(0);
    // Ranked: the rating moved.
    await expect(player.getByRole('heading', { name: 'Рейтинг', exact: true })).toBeVisible();
  }
});

test('level after the first round, one of the two picks the next category, and both play it', async ({
  page: anna,
  newPlayer,
}) => {
  const boris = await newPlayer();
  await Promise.all([startAsGuest(anna), startAsGuest(boris)]);
  const play = (player: typeof anna) => player.getByRole('button', { name: 'Играй Дуел', exact: true }).click();
  await Promise.all([play(anna), play(boris)]);
  await Promise.all([anna, boris].map((player) => expect(player).toHaveURL(/\/game$/)));

  // Neither answers the first round: level on points, rating and right answers, so the first in the match picks. At
  // the tests' speed the pick is open for under a second: it's made at once, and what lasts is checked.
  const asked = (player: typeof anna) => player.getByRole('heading', { name: 'Избери категория', exact: true });
  await expect
    .poll(async () => (await asked(anna).isVisible()) || (await asked(boris).isVisible()), {
      timeout: 30_000,
      intervals: [50],
    })
    .toBe(true);
  const picker = (await asked(anna).isVisible()) ? anna : boris;
  const tiles = picker.locator('button[data-answer]');
  expect(await tiles.count()).toBe(3);
  // The tile's name (its icon and key hint aside); 2 on the keyboard picks it, as a tap would.
  const chosen = (await tiles.nth(1).locator('.font-display').textContent())!.trim();
  await picker.keyboard.press('2');
  // The next round, for both, is in that category.
  for (const player of [anna, boris])
    await expect(player.getByText(new RegExp(`^\\S+ ${chosen}$`)).first()).toBeVisible({ timeout: 10_000 });
  const runs = await Promise.all([playMatch(anna), playMatch(boris)]);
  expect(runs.map((r) => r.total)).toEqual([10, 10]);
});
