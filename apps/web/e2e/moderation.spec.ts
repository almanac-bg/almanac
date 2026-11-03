import { DatabaseSync } from 'node:sqlite';
import { codeAt, stepAt } from '../../server/src/totp';
import { serverDb } from '../playwright.config';
import { choose, expect, makeModerator, type Page, signIn, signUp, test, uniqueName } from './support';

/** A moderator's authenticator app, set up from this page's session (as the admin page does it). */
async function secondFactor(page: Page) {
  const setup = await page.request.post('/api/auth/2fa/setup');
  expect(setup.ok()).toBe(true);
  const { secret } = (await setup.json()) as { secret: string };
  const enabled = await page.request.post('/api/auth/2fa/enable', {
    data: { code: codeAt(secret, stepAt(Date.now())) },
  });
  expect(enabled.ok()).toBe(true);
}

/** Far past the level that unlocks proposing questions (as if they'd played a lot). */
function giveXp(username: string) {
  const db = new DatabaseSync(serverDb);
  db.exec('PRAGMA busy_timeout = 5000');
  db.prepare('UPDATE users SET xp = 100000 WHERE username = ?').run(username);
  db.close();
}

async function openPlayer(page: Page, username: string) {
  await page.goto('/admin?tab=players');
  await page.getByLabel('Търси играч').fill(username.slice(0, 10));
  await page.getByRole('button', { name: 'Търси', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(username) }).click();
  await expect(page.getByRole('link', { name: new RegExp(`^${username}`) })).toBeVisible();
}

test('a moderator stops a profile with a basis and a reason the player reads, and undoes it from the log', async ({
  page,
  newPlayer,
  pageProblems,
}) => {
  const moderator = uniqueName('Проверяващ');
  const player = uniqueName('Играч');
  await signUp(page, moderator, 'parola-123');
  makeModerator(moderator);
  const other = await newPlayer();
  await signUp(other, player, 'parola-123');

  // /admin opens with a second factor to set up; here an authenticator app (passkeys: passkeys.spec.ts): its key on the
  // page, then the code it shows.
  await page.goto('/admin');
  // („Включи“ where the browser can't make passkeys: then the app is the only way.)
  await page.getByRole('button', { name: /^(С приложение за удостоверяване|Включи)$/ }).click();
  // Focus goes where the next step is, never back to the page (A11Y-6): the code field, then the page's heading.
  await expect(page.getByLabel('Код от приложението')).toBeFocused();
  const key = (await page.locator('code').first().textContent())!.replace(/\s/g, '');
  await page.getByLabel('Код от приложението').fill(codeAt(key, stepAt(Date.now())));
  await page.getByRole('button', { name: 'Потвърди' }).click();
  await expect(page.getByRole('heading', { name: 'Модерация' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Модерация' })).toBeFocused();

  await openPlayer(page, player);
  await page.getByRole('button', { name: 'Спри профила', exact: true }).click();
  const stop = page.getByRole('button', { name: 'Спри профила', exact: true }).last();
  await expect(stop, 'not without grounds').toBeDisabled();
  await choose(page, 'Основание (от условията)', /^Нечестна игра/);
  await page.getByLabel('Причина — играчът ще я прочете').fill('Отговаря с програма.');
  await stop.click();
  await expect(page.getByText(/^Спрян до/)).toBeVisible();

  // Signed out by the ban; signing in says why, and where to appeal.
  await other.goto('/');
  await other
    .getByRole('button', { name: 'Имам профил — вход', exact: true })
    .or(other.getByRole('button', { name: 'Вход', exact: true }))
    .first()
    .click();
  await other.getByLabel('Потребителско име или имейл').fill(player);
  await other.getByLabel('Парола', { exact: true }).fill('parola-123');
  await other.getByRole('button', { name: 'Влез', exact: true }).click();
  await expect(other.getByText(/Профилът е спрян до .*Отговаря с програма\..*Ако смяташ, че е грешка/)).toBeVisible();

  await page.goto('/admin?tab=log');
  const entry = page.getByRole('listitem').filter({ hasText: `спря профила на ${player}` });
  await expect(entry).toContainText('Отговаря с програма.');
  await entry.getByRole('button', { name: 'Отмени', exact: true }).click();
  const undo = entry.getByRole('button', { name: 'Отмени решението', exact: true });
  await expect(undo, 'not without a reason').toBeDisabled();
  await entry.getByLabel(/^Защо го отменяш/).fill('Обжалване: беше грешка в играта.');
  await undo.click();
  await expect(entry).toContainText(`отменено от ${moderator}`);
  await expect(entry).toContainText('Отменено, защото: Обжалване: беше грешка в играта.');

  await signIn(other, player, 'parola-123');
  // The browser logs the refused sign-in itself: that's the point here, not a problem.
  const expected = (p: string) => p.includes('status of 403') && p.includes('/api/auth/login');
  pageProblems.splice(0, pageProblems.length, ...pageProblems.filter((p) => !expected(p)));
});

test('a report about a set is a case: the moderator reads the set and hides it, its owner hears why and the reporter what came of it', async ({
  page,
  newPlayer,
}) => {
  const moderator = uniqueName('Проверяващ');
  await signUp(page, moderator, 'parola-123');
  makeModerator(moderator);
  await secondFactor(page);
  const owner = await newPlayer();
  await signUp(owner, uniqueName('Автор'), 'parola-123');
  const made = await owner.request.post('/api/sets', {
    data: {
      name: 'Обиден набор',
      questions: [{ kind: 'truefalse', q: 'Това е въпрос с обида към някого?', answer: true }],
    },
  });
  expect(made.ok()).toBe(true);
  const { id } = (await made.json()) as { id: number };
  const { code } = (await (await owner.request.get(`/api/sets/${id}`)).json()) as { code: string };

  const reporter = await newPlayer();
  await signUp(reporter, uniqueName('Сигнал'), 'parola-123');
  await reporter.goto(`/sets/shared/${code}`);
  await reporter.getByRole('button', { name: 'Сигнализирай' }).click();
  const send = reporter.getByRole('button', { name: 'Изпрати', exact: true });
  await expect(send, 'not without a reason').toBeDisabled();
  await reporter.getByLabel('Незаконно съдържание').check();
  await send.click();
  await expect(reporter.getByText('Модератор ще го прегледа, а ти ще научиш какво решихме.')).toBeVisible();

  await page.goto('/admin?tab=reports');
  const card = page.getByRole('article', { name: 'Набор „Обиден набор“' });
  await expect(card.getByText('Незаконно', { exact: true }), 'first, and marked').toBeVisible();
  await card.getByRole('button', { name: 'Прочети набора' }).click();
  await expect(card.getByText('Това е въпрос с обида към някого?')).toBeVisible();
  await card.getByRole('button', { name: 'Скрий набора' }).click();
  await choose(card, 'Основание (от условията)', 'Неподходящо или незаконно съдържание');
  await card.getByLabel('Причина — играчът ще я прочете').fill('Въпросът обижда човек.');
  await card.getByRole('button', { name: 'Скрий набора' }).click();
  await expect(page.getByText('Наборът е скрит')).toBeVisible();

  const note = async (p: Page) =>
    ((await (await p.request.get('/api/notifications')).json()) as { notifications: { text: string }[] })
      .notifications[0].text;
  expect(await note(owner)).toMatch(/Модератор скри набора ти „Обиден набор“.*Въпросът обижда човек\..*до 6 месеца/);
  expect(await note(reporter)).toMatch(/Разгледахме доклада ти за „Обиден набор“: наборът е скрит/);
});

test('a proposed question names where its answer is checked; its author edits or withdraws it while it waits', async ({
  page,
}) => {
  const author = uniqueName('Автор');
  await signUp(page, author, 'parola-123');
  giveXp(author);
  await page.goto('/submit');
  await page.getByRole('button', { name: /География/ }).click();
  await page
    .getByPlaceholder(/напр\. Кой е най-високият връх/)
    .fill('Коя е най-дългата река в България изцяло на нейна територия?');
  for (const [i, option] of ['Искър', 'Марица', 'Янтра', 'Тунджа'].entries())
    await page.getByLabel(`Отговор ${'АБВГ'[i]}`, { exact: true }).fill(option);
  await page.getByRole('button', { name: /верен/ }).first().click();
  await page.getByRole('button', { name: 'Изпрати за одобрение', exact: true }).click();
  await expect(page.getByText('Посочи къде се проверява верният отговор.')).toBeVisible();

  await page.getByLabel('Източник на верния отговор').fill('https://bg.wikipedia.org/wiki/Искър');
  await page.getByRole('button', { name: 'Изпрати за одобрение', exact: true }).click();
  await expect(page.getByText('Благодарим! Въпросът чака одобрение.')).toBeVisible();
  await expect(page.getByText('чакат 1 от 3')).toBeVisible();

  await page.getByRole('button', { name: 'Промени', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Промени предложението' });
  await dialog.getByRole('button', { name: 'Оттегли въпроса', exact: true }).click();
  await dialog.getByRole('button', { name: 'Да, оттегли го', exact: true }).click();
  await expect(page.getByText('Още нямаш предложения')).toBeVisible();
});
