import { expect, gameMs, me, playMatch, signUp, test, uniqueName } from './support';

test('Отбори: one asks a friend from the mode card, the friend says yes, and the two play together', async ({
  page: anna,
  newPlayer,
}) => {
  const annaName = uniqueName('Анна');
  const boris = await newPlayer();
  const borisName = uniqueName('Борис');
  await Promise.all([signUp(anna, annaName, 'parola-123'), signUp(boris, borisName, 'parola-123')]);
  expect((await boris.request.post('/api/friends', { data: { username: annaName } })).ok()).toBe(true);
  expect((await anna.request.post(`/api/friends/${(await me(boris)).id}/accept`)).ok()).toBe(true);

  // The Отбори card asks who with: Boris is online.
  await anna.getByRole('button', { name: 'Играй Отбори', exact: true }).click();
  const picker = anna.getByRole('dialog', { name: 'Отбори: с кого играеш?' });
  await picker.getByRole('listitem').filter({ hasText: borisName }).getByRole('button', { name: 'Покани' }).click();
  await expect(picker.getByText('Поканата е пратена')).toBeVisible();

  // Boris says yes from the invite; both wait as a pair, then play two bots.
  await boris.getByRole('button', { name: `Играй Отбори с ${annaName}` }).click();
  await Promise.all([anna, boris].map((p) => expect(p).toHaveURL(/\/game$/, { timeout: gameMs(15_000) })));
  const [a, b] = await Promise.all([playMatch(anna), playMatch(boris)]);
  expect([a.total, b.total]).toEqual([10, 10]);
});
