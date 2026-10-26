import { expect, expectLobby, playMatch, signUp, test, uniqueName } from './support';

test('a private room: a friend joins by its code, the host starts, both play and come back to the room', async ({
  page: host,
  newPlayer,
}) => {
  const friend = await newPlayer();
  // Rooms are for accounts (a guest is asked to save theirs first).
  await Promise.all([
    signUp(host, uniqueName('host'), 'tajna-parola-1'),
    signUp(friend, uniqueName('friend'), 'tajna-parola-1'),
  ]);

  await host.getByRole('button', { name: /^Създай (своя )?стая$/ }).click();
  await expect(host).toHaveURL(/\/room$/);
  await expect(host.getByRole('heading', { name: 'Частна стая', exact: true })).toBeVisible();
  const code = (await host
    .getByRole('button', { name: /^\d{5}/ })
    .first()
    .textContent())!.match(/\d{5}/)![0];

  // The friend types the code on the lobby.
  await friend.getByPlaceholder('Код на стая').fill(code);
  await friend.getByRole('button', { name: 'Влез', exact: true }).click();
  await expect(friend).toHaveURL(/\/room$/);
  await expect(friend.getByText('Чакаме домакина да започне…').filter({ visible: true }).first()).toBeVisible();
  await expect(host.getByText('Играчи 2/8').filter({ visible: true }).first()).toBeVisible();

  await host
    .getByRole('button', { name: /^Започни/ })
    .filter({ visible: true })
    .first()
    .click();
  await Promise.all([host, friend].map((player) => expect(player).toHaveURL(/\/game$/)));
  const runs = await Promise.all([playMatch(host), playMatch(friend)]);
  expect(runs.map((r) => r.answered)).toEqual([runs[0].total, runs[1].total]);

  // The room outlives the match: both go back to it.
  for (const player of [host, friend]) {
    await player.getByRole('button', { name: 'Обратно в стаята' }).filter({ visible: true }).first().click();
    await expect(player).toHaveURL(/\/room$/);
  }
  await expect(host.getByText('Играчи 2/8').filter({ visible: true }).first()).toBeVisible();

  // The friend leaves; the host sees it.
  await friend.getByRole('button', { name: 'Напусни стаята', exact: true }).click();
  await expectLobby(friend);
  await expect(host.getByText('Играчи 1/8').filter({ visible: true }).first()).toBeVisible();
});
