import { expect, gameMs, me, playMatch, startAsGuest, test } from './support';

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
  browserName,
}) => {
  const boris = await newPlayer();
  await Promise.all([startAsGuest(anna), startAsGuest(boris)]);
  const borisMe = await me(boris);
  const play = (player: typeof anna) => player.getByRole('button', { name: 'Играй Дуел', exact: true }).click();
  await Promise.all([play(anna), play(boris)]);
  await Promise.all([anna, boris].map((player) => expect(player).toHaveURL(/\/game$/)));
  // A loaded machine can be a second late for the queue, and bots take the seats (BOT_FILL_SECONDS): nothing to test.
  // The name anywhere on screen: its first copy in the page can be the screen reader's line, which is never visible
  // (the test once skipped itself half the time, paired all along).
  const paired = await anna
    .getByText(borisMe.username, { exact: true })
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 3_000 })
    .then(
      () => true,
      () => false,
    );
  test.skip(!paired, 'the two were not paired (one waited past the bots’ second)');

  // Neither answers the first round: level on points, rating and right answers, so the first in the match picks. At
  // the tests' speed the pick is open for under a second: it's made at once, and what lasts is checked.
  const asked = (player: typeof anna) => player.getByRole('heading', { name: 'Избери категория', exact: true });
  await expect
    .poll(async () => (await asked(anna).isVisible()) || (await asked(boris).isVisible()), {
      timeout: gameMs(30_000),
      intervals: [50],
    })
    .toBe(true);
  const picker = (await asked(anna).isVisible()) ? anna : boris;
  const tiles = picker.locator('button[data-answer]');
  expect(await tiles.count()).toBe(3);
  // The tiles' names (their icons and key hints aside); 2 on the keyboard picks the second, as a tap would.
  const offered = (await tiles.locator('.font-display').allTextContents()).map((t) => t.trim());
  await picker.keyboard.press('2');
  // The next round, for both, is in that category. (A slower engine can miss the test speed's 0.75 s to pick: then
  // the round is drawn from the same three.)
  const expected = browserName === 'chromium' ? [offered[1]] : offered;
  const category = new RegExp(`^\\S+ (${expected.join('|')})$`);
  await Promise.all(
    [anna, boris].map((player) => expect(player.getByText(category).first()).toBeVisible({ timeout: gameMs(10_000) })),
  );
  const [annaCategory, borisCategory] = await Promise.all(
    [anna, boris].map((player) => player.getByText(category).first().textContent()),
  );
  expect(annaCategory).toBe(borisCategory);
  const runs = await Promise.all([playMatch(anna), playMatch(boris)]);
  expect(runs.map((r) => r.total)).toEqual([10, 10]);
});

test('a rematch: one asks from the results, the other accepts, and the same two play again', async ({
  page: anna,
  newPlayer,
}) => {
  const boris = await newPlayer();
  await Promise.all([startAsGuest(anna), startAsGuest(boris)]);
  const play = (player: typeof anna) => player.getByRole('button', { name: 'Играй Дуел', exact: true }).click();
  await Promise.all([play(anna), play(boris)]);
  await Promise.all([playMatch(anna), playMatch(boris)]);

  await anna.getByRole('button', { name: 'Реванш', exact: true }).first().click();
  // (Role queries skip the copy that's hidden on a phone: the offer shows in the sticky bar there.)
  await expect(boris.getByRole('status').filter({ hasText: /иска реванш!$/ })).toBeVisible();
  await boris.getByRole('button', { name: 'Приеми', exact: true }).first().click();

  // A new match, the two of them again: its first question on both screens.
  for (const player of [anna, boris])
    await expect(player.getByText(/^Въпрос 1 от \d+$/)).toBeVisible({ timeout: gameMs(15_000) });
  const runs = await Promise.all([playMatch(anna), playMatch(boris)]);
  expect(runs.map((r) => r.answered)).toEqual([10, 10]);
  await expect(anna.getByText((await me(boris)).username, { exact: true }).first()).toBeVisible();
});
