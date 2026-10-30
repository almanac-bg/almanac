import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, signUp, test, uniqueName } from './support';

// The server the tests run against (playwright.config.ts): its database.
const dbPath = path.resolve(import.meta.dirname, '../test-results/server/quiz.db');

function setLevel(username: string, level: number) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  db.prepare('UPDATE users SET xp = ? WHERE username = ?').run(50 * level * (level - 1), username);
  db.close();
}

test('every fifth level a reward to pick: one of two, and the other still there at the next milestone', async ({
  page,
}) => {
  const name = uniqueName('nagrada');
  await signUp(page, name, 'parola-za-nagrada');
  setLevel(name, 11);
  await page.reload();
  await page.getByRole('link', { name: /Избери награда за ниво 5/ }).click();
  await expect(page).toHaveURL(/\/locker$/);
  await expect(page.getByRole('heading', { name: /Ниво 5: избери награда/ })).toBeVisible();
  const take = page.getByRole('button', { name: /^Вземи/ });
  await expect(page.getByRole('button', { name: 'Избери едно', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Видра аватар', exact: true }).click();
  await take.click();
  await expect(page.getByText('Взе „Видра“')).toBeVisible();
  // The next milestone: its two frames, or the hedgehog left at 5.
  await expect(page.getByRole('heading', { name: /Ниво 10: избери награда/ })).toBeVisible();
  await expect(page.getByText('Или нещо, оставено на по-ранно ниво:')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Таралеж', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Лавандула рамка', exact: true })).toBeVisible();
});
