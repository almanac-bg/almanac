import { expect, me, playMatch, signUp, test, uniqueName } from './support';

test('a class: the teacher writes a set, runs it on a big screen, and a pupil joins by link under a name of their own', async ({
  page: teacher,
  newPlayer,
}) => {
  await signUp(teacher, uniqueName('Учител'), 'parola-123');

  // „Моите въпроси“: a set with a question of four and a true-or-false.
  await teacher.goto('/sets');
  await teacher.getByRole('button', { name: 'Нов набор' }).click();
  await expect(teacher).toHaveURL(/\/sets\/\d+$/);
  await teacher.getByLabel('Име на набора').fill('Урок 5');
  await teacher.getByRole('button', { name: /^Въпрос 1/ }).click();
  await teacher.getByLabel('Текст на въпрос 1').fill('Коя е столицата на България?');
  for (const [letter, text] of [
    ['А', 'София'],
    ['Б', 'Пловдив'],
    ['В', 'Варна'],
    ['Г', 'Бургас'],
  ])
    await teacher.getByLabel(`Отговор ${letter}`).fill(text);
  await teacher.getByRole('button', { name: /^Въпрос 2/ }).click();
  await teacher.getByRole('button', { name: 'Вярно/невярно' }).last().click();
  await teacher.getByLabel('Текст на въпрос 2').fill('Дунав се влива в Черно море.');
  await teacher.getByRole('button', { name: 'Запази' }).click();
  await expect(teacher.getByText('2 от 50 въпроса · запазено')).toBeVisible();

  // A room on it, run from the big screen.
  await teacher.goto('/');
  await teacher.getByRole('button', { name: /^Създай (своя )?стая$/ }).click();
  await expect(teacher).toHaveURL(/\/room$/);
  // By its value, found by its text: engines differ on an option's label once it starts with an emoji.
  const sets = teacher.getByLabel('Въпроси', { exact: true });
  await sets.selectOption((await sets.locator('option', { hasText: 'Урок 5 (2)' }).getAttribute('value'))!);
  await expect(teacher.getByText('Всичките 2 въпроса, в реда на набора.', { exact: false })).toBeVisible();
  await teacher.getByRole('switch', { name: 'Само водя' }).click();
  await expect(teacher.getByText('Води на голям екран · не играе')).toBeVisible();
  const code = (await teacher
    .getByRole('button', { name: /^\d{6}/ })
    .first()
    .textContent())!.match(/\d{6}/)![0];

  // A pupil with the link and no account: in as a guest, then a name for the room.
  const pupil = await newPlayer();
  await pupil.goto(`/join/${code}`);
  await pupil.getByRole('button', { name: 'Влез като гост' }).first().click();
  await pupil.getByLabel('Име в стаята').fill('Мария 7Б');
  await pupil.getByRole('button', { name: 'Влез в стаята' }).click();
  await expect(pupil).toHaveURL(/\/room$/);
  await expect(teacher.getByText('Мария 7Б')).toBeVisible();
  expect((await me(pupil)).isGuest).toBe(true);

  await teacher
    .getByRole('button', { name: /^Започни/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(pupil).toHaveURL(/\/game$/);
  await expect(teacher).toHaveURL(/\/game$/);
  // The big screen: the set's question, large; the pupil answers on the phone.
  await expect(teacher.getByRole('heading', { name: 'Коя е столицата на България?' })).toBeVisible({ timeout: 10_000 });
  const run = await playMatch(pupil);
  expect(run).toEqual({ answered: 2, total: 2 });
  await expect(teacher.getByRole('heading', { name: 'Край!' })).toBeVisible();
  await expect(teacher.getByText('Мария 7Б')).toBeVisible();
});
