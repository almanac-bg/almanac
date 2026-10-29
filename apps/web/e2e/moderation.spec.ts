import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, type Page, signIn, signUp, test, uniqueName } from './support';

// The server the tests run against (playwright.config.ts): its database, and the admin command line next to it.
const root = path.resolve(import.meta.dirname, '../../..');
const dbPath = path.resolve(import.meta.dirname, '../test-results/server/quiz.db');

function makeModerator(username: string) {
  const cli = spawnSync(process.execPath, [path.join(root, 'apps/server/dist/cli.mjs'), 'admin', 'add', username], {
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8',
  });
  expect(cli.status, cli.stderr).toBe(0);
}

/** Far past the level that unlocks proposing questions (as if they'd played a lot). */
function giveXp(username: string) {
  const db = new DatabaseSync(dbPath);
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

  await openPlayer(page, player);
  await page.getByRole('button', { name: 'Спри профила', exact: true }).click();
  const stop = page.getByRole('button', { name: 'Спри профила', exact: true }).last();
  await expect(stop, 'not without grounds').toBeDisabled();
  await page.getByLabel('Основание (от условията)').selectOption('cheating');
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
  await entry.getByRole('button', { name: 'Сигурно? Отмени', exact: true }).click();
  await expect(entry).toContainText(`отменено от ${moderator}`);

  await signIn(other, player, 'parola-123');
  // The browser logs the refused sign-in itself: that's the point here, not a problem.
  const expected = (p: string) => p.includes('status of 403') && p.includes('/api/auth/login');
  pageProblems.splice(0, pageProblems.length, ...pageProblems.filter((p) => !expected(p)));
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
