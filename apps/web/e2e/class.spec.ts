import { DatabaseSync } from 'node:sqlite';
import { serverDb } from '../playwright.config';
import { choose, expect, gameMs, me, playMatch, png, roomCode, signUp, test, uniqueName } from './support';

test('a class: the teacher writes a set, runs it on a big screen, and a pupil joins by link under a name of their own', async ({
  page: teacher,
  newPlayer,
}) => {
  await signUp(teacher, uniqueName('Учител'), 'parola-123');

  // „Моите въпроси“: a set with a question of four and a true-or-false.
  await teacher.goto('/sets');
  await teacher.getByRole('button', { name: 'Нов набор' }).click();
  await expect(teacher).toHaveURL(/\/sets\/\d+$/);
  const setName = teacher.getByLabel('Име на набора');
  await setName.fill('Урок 5');
  // Where a lost name would show (WebKit in CI once saved „Нов набор“): kept as typed, and still there at the save.
  await expect(setName).toHaveValue('Урок 5');
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
  await expect(setName).toHaveValue('Урок 5');
  await teacher.getByRole('button', { name: 'Запази' }).click();
  await expect(teacher.getByText('2 от 50 въпроса · запазено')).toBeVisible();

  // A room on it, run from the big screen.
  await teacher.goto('/');
  await teacher.getByRole('button', { name: /^Създай (своя )?стая$/ }).click();
  await expect(teacher).toHaveURL(/\/room$/);
  await choose(teacher, 'Въпроси', /^Урок 5/);
  await expect(teacher.getByText('Всичките 2 въпроса, в реда на набора.', { exact: false })).toBeVisible();
  await teacher.getByRole('switch', { name: 'Само водя' }).click();
  // The projector's lobby (VD-8): where to go and the code, big, and a QR code of the invite link.
  await expect(teacher.getByRole('heading', { name: /^Влезте от телефона/ })).toBeVisible();
  await expect(teacher.getByRole('img', { name: /^QR код, който отваря стая \d{6}$/ })).toBeVisible();
  const code = await roomCode(teacher);

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
  // On the answer (an open question has its own „Пауза“, which stops its clock).
  await expect(teacher.getByText(/ познаха$/)).toBeVisible({ timeout: gameMs(3_000) });
  await teacher.getByRole('button', { name: 'Пауза', exact: true }).click({ timeout: gameMs(3_000) });
  await expect(teacher.getByText('На пауза', { exact: true })).toBeVisible();
  await expect(pupil.locator('p:not([aria-live])', { hasText: 'Пауза на големия екран' })).toBeVisible();
  // …and said to a screen reader by the match's live region, which is always there (one inserted with its text isn't).
  await expect(pupil.locator('[aria-live="polite"]').filter({ hasText: 'Пауза на големия екран' })).toHaveCount(1);
  await teacher.waitForTimeout(gameMs(2_000));
  await expect(teacher.getByText('Въпрос 1 от 2', { exact: true })).toBeVisible();
  await teacher.keyboard.press('ArrowRight');
  await expect(teacher.getByRole('heading', { name: 'Дунав се влива в Черно море.' })).toBeVisible();
  const run = await playMatch(pupil);
  expect(run).toEqual({ answered: 1, total: 2 });
  await expect(teacher.getByRole('heading', { name: 'Край!' })).toBeVisible();
  await expect(teacher.getByText('Мария 7Б')).toBeVisible();
  // The pupil's results: what happens to a room's guest, the questions — and nothing celebrated as theirs (UX-2).
  await expect(pupil.getByText('Влезе като гост за стаята', { exact: false })).toBeVisible();
  await expect(pupil.getByRole('heading', { name: 'Награди', exact: true })).toHaveCount(0);
  await expect(pupil.getByRole('dialog')).toHaveCount(0);
});

// A field focused the moment its page opens keeps the focus: the move's focus on the page heading (lib/routeFocus.ts)
// came between a tap and the typing, and the name went nowhere — „Нов набор“ was saved (the 31 October review,
// REPO-1; a loaded CI runner hit it in WebKit and Firefox).
test('a field taken as its page opens keeps the focus: what is typed lands in it', async ({ page }) => {
  await signUp(page, uniqueName('Бърз'), 'parola-123');
  await page.goto('/sets');
  // The name field taken the instant it's drawn, before the move's own focus looks for the heading.
  await page.evaluate(() => {
    new MutationObserver((_, observer) => {
      const field = document.getElementById('set-name');
      if (!field) return;
      field.focus();
      observer.disconnect();
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole('button', { name: 'Нов набор' }).click();
  const setName = page.getByLabel('Име на набора');
  await expect(setName).toBeVisible();
  // As a busy device would: a moment between taking the field and the first key. The focus stays put meanwhile.
  await page.waitForTimeout(300);
  await expect(setName).toBeFocused();
  await page.keyboard.insertText(' за 5 клас');
  await expect(setName).toHaveValue('Нов набор за 5 клас');
});

test('a teacher from /teachers: one way in to a room for the class, through sign-up; a set goes into a room from its card (UX-4)', async ({
  page: teacher,
}) => {
  await teacher.goto('/teachers');
  // The way in at the top, not only after the whole page.
  await teacher.getByRole('link', { name: 'Отвори стая за класа' }).first().click();
  await expect(teacher).toHaveURL(/\/class$/);
  await expect(teacher.getByText('Стая за класа', { exact: true })).toBeVisible();
  // A room needs a profile: no guest button here.
  await expect(teacher.getByRole('button', { name: 'Играй като гост', exact: true })).toHaveCount(0);
  await teacher.getByLabel('Потребителско име', { exact: true }).fill(uniqueName('Учител'));
  await teacher.getByLabel('Парола', { exact: true }).fill('parola-123');
  await teacher.getByRole('button', { name: /^Създай профил/ }).click();
  // Straight into the room, run from the big screen, open to a whole class.
  await expect(teacher).toHaveURL(/\/room$/);
  await expect(teacher.getByRole('heading', { name: /^Влезте от телефона/ })).toBeVisible();
  await teacher.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(teacher.getByRole('switch', { name: 'Само водя' })).toBeChecked();
  await teacher.keyboard.press('Escape');

  // A set, then „Пусни в стая“ from its card: a new room with that set in it.
  await teacher.goto('/sets');
  await teacher.getByRole('button', { name: 'Нов набор' }).click();
  await expect(teacher).toHaveURL(/\/sets\/\d+$/);
  await teacher.getByLabel('Име на набора').fill('Урок 6');
  await teacher.getByRole('button', { name: /^Въпрос 1/ }).click();
  await teacher.getByRole('button', { name: 'Вярно/невярно' }).last().click();
  await teacher.getByLabel('Текст на въпрос 1').fill('Дунав се влива в Черно море.');
  await teacher.getByRole('button', { name: 'Запази' }).click();
  await expect(teacher.getByText('1 от 50 въпроса · запазено')).toBeVisible();
  await teacher.goto('/sets');
  await teacher.getByRole('link', { name: 'Пусни в стая' }).click();
  await expect(teacher).toHaveURL(/\/room$/);
  await teacher.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(teacher.getByText('Всичките 1 въпроса, в реда на набора.', { exact: false })).toBeVisible();
  await expect(teacher.getByRole('switch', { name: 'Само водя' })).toBeChecked();
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
  const code = await roomCode(teacher);

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
  const name = uniqueName('Учител');
  await signUp(page, name, 'parola-123');
  // Pictures come from an account with a confirmed address (or one that has played a while): as if confirmed.
  const db = new DatabaseSync(serverDb);
  db.exec('PRAGMA busy_timeout = 5000');
  db.prepare('UPDATE users SET email = ?, email_key = ? WHERE username = ?').run(
    `${name}@example.test`.toLowerCase(),
    `${name}@example.test`.toLowerCase(),
    name,
  );
  db.close();
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

test('a pupil who mistyped the room’s code corrects it where the error is, the name kept (UX-11)', async ({
  page: teacher,
  newPlayer,
}) => {
  await signUp(teacher, uniqueName('Учител'), 'parola-123');
  await teacher.getByRole('button', { name: /^Създай (своя )?стая$/ }).click();
  await expect(teacher).toHaveURL(/\/room$/);
  const code = await roomCode(teacher);
  const wrong = code.startsWith('1') ? '222222' : '111111';

  const pupil = await newPlayer();
  await pupil.goto('/');
  await pupil.getByRole('button', { name: 'Имам код за стая' }).click();
  await pupil.getByLabel('Код на стая').fill(wrong);
  await pupil.getByRole('button', { name: 'Влез в стаята' }).click();
  await pupil.getByRole('button', { name: 'Влез като гост' }).first().click();
  await pupil.getByLabel('Име в стаята').fill('Ния');
  await pupil.getByRole('button', { name: 'Влез в стаята' }).click();
  // Not a dead end: the code to check, the name still there.
  const field = pupil.getByLabel('Код на стаята');
  await expect(field).toHaveValue(wrong);
  await expect(pupil.getByText(`Няма стая с код ${wrong}`, { exact: false })).toBeVisible();
  await expect(pupil.getByLabel('Име в стаята')).toHaveValue('Ния');
  await field.fill(code);
  await pupil.getByRole('button', { name: 'Влез в стаята' }).click();
  await expect(pupil).toHaveURL(/\/room$/);
  await expect(teacher.getByText('Ния', { exact: true })).toBeVisible();
});
