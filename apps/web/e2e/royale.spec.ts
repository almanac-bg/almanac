import { expect, gameMs, playMatch, startAsGuest, test } from './support';

// Both tests queue for Роял (bots fill its seats a second after one joins): one at a time, so they can't meet.
test.describe.configure({ mode: 'serial' });

test('Роял through an elimination: knocked out at the first cut, the player gets the last place and when it ended', async ({
  page,
  queue,
}) => {
  test.setTimeout(120_000);
  await startAsGuest(page);
  await queue('royale');
  await page.getByRole('button', { name: 'Играй Роял', exact: true }).click();
  await expect(page).toHaveURL(/\/game$/);
  await expect(page.getByText(/^Въпрос 1 от \d+$/)).toBeVisible({ timeout: gameMs(15_000) });

  // Not a single answer: the lowest score goes at the first knockout, after question 4. With only bots left, the rest
  // is decided at once (GamePage says so for the moment it takes), and the results come.
  await expect(page.getByRole('heading', { name: 'Награди', exact: true })).toBeVisible({ timeout: gameMs(90_000) });
  await expect(page.getByText('Отпадна след въпрос 4', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '8-мо място', exact: true })).toBeVisible();
});

test('Роял: knocked out with only bots left, the player answers on and „Към резултата“ brings the result at once', async ({
  page,
  queue,
}) => {
  test.setTimeout(150_000);
  await startAsGuest(page);
  await queue('royale');
  await page.getByRole('button', { name: 'Играй Роял', exact: true }).click();
  await expect(page).toHaveURL(/\/game$/);

  // Answering А every time (a quarter of them right, against bots that know more) goes out at some cut — having
  // answered that question, so the match goes on at the player's pace until they ask for the result.
  const toResult = page.getByRole('button', { name: 'Към резултата', exact: true });
  const results = page.getByRole('heading', { name: 'Награди', exact: true });
  const finished = new Error('finished');
  let outAt = 0;
  await playMatch(page, {
    onQuestion: async (index) => {
      if (!(await toResult.isVisible())) return;
      outAt = index;
      await expect(page.getByText('Отпадна · отговаряш за XP')).toBeVisible();
      await toResult.click();
      await expect(results).toBeVisible({ timeout: gameMs(10_000) });
      throw finished;
    },
  }).catch((err) => {
    if (err !== finished) throw err;
  });
  test.skip(!outAt, 'never knocked out: it happens, rarely');
  await expect(results).toBeVisible();
  await expect(page.getByText(/Отпадна след въпрос\s\d+$/)).toBeVisible();
});
