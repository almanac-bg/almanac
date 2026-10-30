import { expect, expectLobby, gameMs, me, playMatch, startAsGuest, test } from './support';

test("a newcomer's first tap plays the day's questions; a duel is the next thing to try", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Играй въпросите на деня', exact: true }).first().click();
  await expect(page).toHaveURL(/\/game$/);
  expect(await playMatch(page)).toEqual({ answered: 10, total: 10 });

  await expect(page.getByText('Въпросите на деня', { exact: true }).first()).toBeVisible();
  // A guest is off the day's board, and sees where it would stand on it (once the day has a few runs to place it in).
  await expect(page.getByRole('heading', { name: /^(Щеше да си|Днешното класиране)$/ })).toBeVisible();
  await expect(page.getByText(/Запази профила/).first()).toBeVisible();
  expect((await me(page)).isGuest).toBe(true);
  await expect(page.getByRole('button', { name: 'Играй Дуел', exact: true })).toBeVisible();
});

test("a visitor answers the landing's one question: the right answer and its fact, then the day's ten a tap away", async ({
  page,
}) => {
  await page.goto('/');
  const sample = page.getByRole('region', { name: /Валя Балканска/ });
  await sample.getByRole('button', { name: /^Б\) / }).click();
  await expect(sample.getByRole('button', { name: /— твоят избор, грешен$/ })).toBeVisible();
  await expect(sample.getByRole('button', { name: /^А\) .* — верен отговор$/ })).toBeVisible();
  await expect(sample.getByText('Знаеше ли?', { exact: true })).toBeVisible();
  // Answered once: the others can't be pressed any more.
  await expect(sample.getByRole('button', { name: /^В\) / })).toBeDisabled();
  await sample.getByRole('button', { name: 'Играй въпросите на деня', exact: true }).click();
  await expect(page).toHaveURL(/\/game$/);
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

test('one attempt a day: walking out after the first question uses it, and nothing offers it again', async ({
  page,
}) => {
  await startAsGuest(page);
  await page.getByRole('button', { name: /^Играй днешните/ }).click();
  await expect(page).toHaveURL(/\/game$/);
  await expect(page.getByRole('button', { name: /^[АБВГ]\) /, disabled: false }).first()).toBeVisible({
    timeout: gameMs(15_000),
  });

  await page.goBack();
  await page
    .getByRole('dialog', { name: 'Да напуснеш ли мача?', exact: true })
    .getByRole('button', { name: 'Напусни', exact: true })
    .click();
  await expectLobby(page);
  // What was played counts as the day's run (its score so far): the card shows it, and offers no second go.
  const used = page.getByText('Твоят резултат', { exact: true }).or(page.getByText(/^Днешният опит е използван\./));
  await expect(used.first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Играй днешните/ })).toHaveCount(0);

  // Nor the day's page, opened straight (as from a shared link's „Играй“): no match starts.
  await page.goto('/daily');
  await expect(
    page.getByRole('button', { name: 'Прати днешните въпроси' }).or(page.getByText(/^Днешният опит е използван\./)),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/daily$/);
  await expect(page.getByRole('button', { name: /^Играй днешните/ })).toHaveCount(0);
});
