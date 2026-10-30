import { expect, gameMs, me, playMatch, png, signUp, test, uniqueName } from './support';

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
    .getByRole('button', { name: /^Код [\d ]+ — копирай/ })
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
  // A guest only for the room: gone within an hour of leaving.
  expect(await me(pupil)).toMatchObject({ isGuest: true, roomGuest: true });

  await teacher
    .getByRole('button', { name: /^Започни/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(pupil).toHaveURL(/\/game$/);
  await expect(teacher).toHaveURL(/\/game$/);
  // The big screen: the set's question, large; the pupil answers on the phone.
  await expect(teacher.getByRole('heading', { name: 'Коя е столицата на България?' })).toBeVisible({
    timeout: gameMs(10_000),
  });
  // The teacher stops on the answer to talk it through, then goes on from the keyboard (a presenter's clicker sends →).
  await pupil.getByRole('button', { name: /^[АБВГ]\) София/ }).click();
  await teacher.getByRole('button', { name: 'Пауза', exact: true }).click({ timeout: gameMs(3_000) });
  await expect(teacher.getByText('На пауза', { exact: true })).toBeVisible();
  await expect(pupil.getByText('Пауза на големия екран', { exact: false })).toBeVisible();
  await teacher.waitForTimeout(gameMs(2_000));
  await expect(teacher.getByText('Въпрос 1 от 2', { exact: true })).toBeVisible();
  await teacher.keyboard.press('ArrowRight');
  await expect(teacher.getByRole('heading', { name: 'Дунав се влива в Черно море.' })).toBeVisible();
  const run = await playMatch(pupil);
  expect(run).toEqual({ answered: 1, total: 2 });
  await expect(teacher.getByRole('heading', { name: 'Край!' })).toBeVisible();
  await expect(teacher.getByText('Мария 7Б')).toBeVisible();
});

test('a locked room: a pupil with the code from the landing knocks, the teacher lets them in and swaps a typed name; one not let in is told', async ({
  page: teacher,
  newPlayer,
}) => {
  await signUp(teacher, uniqueName('Учител'), 'parola-123');
  await teacher.getByRole('button', { name: /^Създай (своя )?стая$/ }).click();
  await expect(teacher).toHaveURL(/\/room$/);
  await teacher.getByRole('switch', { name: 'Заключи стаята' }).click();
  await expect(teacher.getByRole('switch', { name: 'Заключи стаята' })).toHaveAttribute('aria-checked', 'true');
  const code = (await teacher
    .getByRole('button', { name: /^Код [\d ]+ — копирай/ })
    .first()
    .textContent())!.match(/\d{6}/)![0];

  // „almanac.bg, код …“ on the board: the landing takes the code, its page makes a guest for the room.
  const knock = async (name: string) => {
    const pupil = await newPlayer();
    await pupil.goto('/');
    await pupil.getByRole('button', { name: 'Имам код за стая' }).click();
    await pupil.getByLabel('Код на стая').fill(code);
    await pupil.getByRole('button', { name: 'Влез в стаята' }).click();
    await expect(pupil).toHaveURL(new RegExp(`/join/${code}$`));
    await pupil.getByRole('button', { name: 'Влез като гост' }).first().click();
    await pupil.getByLabel('Име в стаята').fill(name);
    await pupil.getByRole('button', { name: 'Влез в стаята' }).click();
    await expect(pupil.getByRole('heading', { name: 'Чакаш домакина' })).toBeVisible();
    return pupil;
  };

  const toni = await knock('Тони');
  await expect(teacher.getByRole('heading', { name: /^На вратата/ })).toBeVisible();
  await teacher.getByRole('button', { name: 'Пусни Тони' }).click();
  await expect(toni).toHaveURL(/\/room$/);
  expect(await me(toni)).toMatchObject({ isGuest: true, roomGuest: true });
  await teacher.getByRole('button', { name: 'Смени името Тони на „Играч“ с номер' }).click();
  await expect(teacher.getByText('Играч 1', { exact: true })).toBeVisible();
  await expect(toni.getByText('Домакинът смени името ти в стаята на „Играч 1“.')).toBeVisible();

  const boby = await knock('Боби');
  await teacher.getByRole('button', { name: 'Не пускай Боби' }).click();
  await expect(boby.getByRole('heading', { name: 'Не влезе в стаята' })).toBeVisible();
  await expect(boby.getByText('Домакинът не те пусна в стаята.')).toBeVisible();
  await expect(teacher.getByRole('heading', { name: /^На вратата/ })).toHaveCount(0);
});

test('a picture for a set’s question: picked on the device, made small, uploaded (Safari’s too) and shown only by its signed address', async ({
  page,
}) => {
  await signUp(page, uniqueName('Учител'), 'parola-123');
  await page.goto('/sets');
  await page.getByRole('button', { name: 'Нов набор' }).click();
  await expect(page).toHaveURL(/\/sets\/\d+$/);
  await page.getByLabel('Име на набора').fill('Крепости');
  await page.getByRole('button', { name: /^Въпрос 1/ }).click();
  await page.getByRole('button', { name: 'Вярно/невярно' }).last().click();
  await page.getByLabel('Текст на въпрос 1').fill('Това е Царевец.');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Снимка към въпроса' }).click(),
  ]);
  await chooser.setFiles({ name: 'krepost.png', mimeType: 'image/png', buffer: png(240, 180) });
  const picture = page.getByRole('img', { name: 'Снимката към въпрос 1' });
  await expect(picture).toBeVisible();
  // Loaded, from an address the server signed (the bare one serves nothing).
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const src = (await picture.getAttribute('src'))!;
  expect(src).toMatch(/^\/api\/sets\/images\/[0-9a-f]{16}\?e=\d+&s=/);
  expect((await page.request.get(src.split('?')[0])).status()).toBe(404);
  await page.getByLabel('Какво има на снимката — за незрящите, без да издава отговора').fill('Крепост на хълм');
  await page.getByRole('button', { name: 'Запази' }).click();
  await expect(page.getByText('1 от 50 въпроса · запазено')).toBeVisible();
});
