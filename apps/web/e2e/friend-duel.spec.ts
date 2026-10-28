import { expect, me, playMatch, signUp, test, uniqueName } from './support';

test('a friend duel: one plays it now, the other later from the home page, and both see how it ended', async ({
  page: anna,
  newPlayer,
}) => {
  const annaName = uniqueName('Анна');
  const borisName = uniqueName('Борис');
  await signUp(anna, annaName, 'parola-123');
  const boris = await newPlayer();
  await signUp(boris, borisName, 'parola-123');
  // Friends (the friends page has a test of its own).
  expect((await boris.request.post('/api/friends', { data: { username: annaName } })).ok()).toBe(true);
  const borisMe = await me(boris);
  expect((await anna.request.post(`/api/friends/${borisMe.id}/accept`)).ok()).toBe(true);

  // Anna starts it from the friends page, offline friend or not, and plays it at once.
  await anna.goto('/friends');
  await anna.getByRole('button', { name: 'Дуел', exact: true }).click();
  await expect(anna).toHaveURL(/\/game$/);
  expect((await playMatch(anna)).total).toBe(10);
  await expect(anna.getByRole('heading', { name: 'Ходът ти е изигран', exact: true })).toBeVisible();
  await expect(anna.getByText(new RegExp(`^Чакаме ${borisName} · остават 2[34] ч\\.$`))).toBeVisible();

  // Boris: his turn, at the top of the home page (and in the card with his friends).
  await boris.goto('/');
  await expect(boris.getByText(`${annaName} те предизвика на дуел`)).toBeVisible();
  await expect(boris.getByRole('link', { name: new RegExp(`^Дуел с ${annaName}: .* т\\. за биене`) })).toBeVisible();
  await boris.getByRole('button', { name: 'Играй', exact: true }).first().click();
  await expect(boris).toHaveURL(/\/game$/);
  await playMatch(boris);
  const outcome = boris.getByRole('heading', { name: /^(Победа!|Загуба|Равенство)$/ });
  await expect(outcome).toBeVisible();
  await expect(boris.getByText(/^Дуели помежду ви:/)).toBeVisible();

  // A rematch: whoever lost picks its three categories, a round each; the winner's are drawn.
  const lost = (await outcome.textContent()) === 'Загуба';
  await boris.getByRole('button', { name: 'Реванш' }).click();
  if (lost) {
    const picker = boris.getByRole('dialog', { name: 'Избери категориите' });
    for (const name of ['История', 'Музика', 'Спорт']) await picker.getByRole('button', { name }).click();
    await picker.getByRole('button', { name: /^Играй/ }).click();
  }
  await expect(boris.getByText(/^Въпрос 1 от 10$/)).toBeAttached({ timeout: 10_000 });
  if (lost) await expect(boris.getByText('🏛️ История').first()).toBeVisible();
  expect((await playMatch(boris)).total).toBe(10);

  // Anna sees how it ended among her duels.
  await anna.goto('/friends');
  await expect(
    anna.getByRole('link', { name: new RegExp(`^Дуел с ${borisName}: (Победа|Загуба|Равенство) · `) }),
  ).toBeVisible();
});
