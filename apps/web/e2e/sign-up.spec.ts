import { expect, openForm, test } from './support';

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
  await expect(error).toHaveText('Избери потребителско име. Избери парола — поне 8 символа.');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toBeFocused();

  await name.fill('ab');
  await password.fill('parola-123');
  await submit.click();
  await expect(error).toHaveText('Името трябва да е поне 3 символа.');

  await name.fill('abc');
  await password.fill('123');
  await submit.click();
  await expect(error).toHaveText('Паролата трябва да е поне 8 символа.');
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toHaveAttribute('aria-invalid', 'false');
  await expect(password).toBeFocused();

  // Nothing was sent: still the form, no account.
  await expect(page.getByRole('heading', { name: 'Създай профил', exact: true })).toBeVisible();
  expect((await page.request.get('/api/me').then((res) => res.json())).user).toBeNull();
});
