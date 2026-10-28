import { expect, startAsGuest, startSolo, test } from './support';

test('a solo match ends on a number, typed on the keyboard, shown on a line against the answer @desktop', async ({
  page,
}) => {
  await startAsGuest(page);
  // Both of the sample's general number questions are typed (no slider).
  await startSolo(page, 'Обща култура');
  const lock = page.getByRole('button', { name: 'Заключи', exact: true });
  const option = page.getByRole('button', { name: /^[АБВГ]\) /, disabled: false });
  // Nine questions with options, then the final.
  for (let i = 0; i < 9; i++) {
    await expect(option.first()).toBeVisible({ timeout: 15_000 });
    await option.first().click();
    await expect(page.getByRole('button', { name: /твоят избор/ })).toBeVisible();
  }
  await expect(lock).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Финал', { exact: false }).first()).toBeVisible();
  // No козове on a number.
  await expect(page.locator('[data-powerup]')).toHaveCount(0);

  const readout = page.locator('output');
  await expect(lock).toBeDisabled();
  // The range's low end ("от 1000 до 2026"), its last digit mistyped and put right.
  const range = (await page.getByText(/^от .+ до .+$/).textContent())!;
  const low = range.slice(3, range.indexOf(' до ')).replace(/[^\d]/g, '');
  const mistyped = `${low.slice(0, -1)}${low.endsWith('9') ? '8' : '9'}`;
  await page.keyboard.type(mistyped);
  await expect(readout).toContainText(mistyped);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(low.slice(-1));
  await expect(readout).toContainText(low);
  await expect(lock).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(lock).toBeHidden();
  await expect(readout).toHaveAttribute('aria-label', new RegExp(`Твоят отговор: ${low}`));

  // The reveal: a line with the answer on it, and how far off the number was.
  await expect(page.getByText(/^(точно|[+−].+|[×÷].+)$/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Награди', exact: true })).toBeVisible({ timeout: 15_000 });
  // The review says what was typed against the answer.
  await page.getByRole('button', { name: /Преглед на въпросите/ }).click();
  await expect(page.getByText(new RegExp(`^Ти: ${low} \\(`))).toBeVisible();
});
