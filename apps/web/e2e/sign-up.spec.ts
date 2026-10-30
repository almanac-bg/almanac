import { expect, openForm, signUp, test, uniqueName } from './support';

// The browser's own validation bubbles speak the device's language (often English): the form says what's wrong
// itself, in Bulgarian, and marks the field.
test('signing up with too short a name or password says why, in Bulgarian', async ({ page }) => {
  await page.goto('/');
  await openForm(page, 'Регистрация');
  const name = page.getByLabel('Потребителско име', { exact: true });
  const password = page.getByLabel('Парола', { exact: true });
  const submit = page.getByRole('button', { name: /^Създай профил/ });
  const error = page.getByRole('alert');

  // Everything at once, and the first field to fix has the focus.
  await submit.click();
  await expect(error).toHaveText('Избери потребителско име. Избери парола — поне 8 знака.');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toBeFocused();

  await name.fill('ab');
  await password.fill('parola-123');
  await submit.click();
  await expect(error).toHaveText('Името трябва да е поне 3 знака.');

  await name.fill('abc');
  await password.fill('123');
  await submit.click();
  await expect(error).toHaveText('Паролата трябва да е поне 8 знака.');
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toHaveAttribute('aria-invalid', 'false');
  await expect(password).toBeFocused();

  // Nothing was sent: still the form, no account.
  await expect(page.getByRole('heading', { name: 'Създай профил', exact: true })).toBeVisible();
  expect((await page.request.get('/api/me').then((res) => res.json())).user).toBeNull();
});

test('signing out on a shared device leaves nothing of the player in the browser: share texts, the name used in a room', async ({
  page,
}) => {
  await signUp(page, uniqueName('Споделен'), 'parola-123');
  await page.evaluate(() => {
    localStorage.setItem('quiz:daily-share:2026-10-30', '⚡ АЛМАНАХ №1 · 8/10');
    localStorage.setItem('quiz:room-nickname', 'Мария 7Б');
    sessionStorage.setItem('quiz:room-nickname', 'Мария 7Б');
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Изход', exact: true }).click();
  await page.getByRole('button', { name: 'Излез', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(
    await page.evaluate(() =>
      [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter(
        (k) => k.startsWith('quiz:daily-share:') || k === 'quiz:room-nickname',
      ),
    ),
  ).toEqual([]);
});
