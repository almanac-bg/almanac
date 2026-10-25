import { expect, me, playMatch, startAsGuest, test } from './support';

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
